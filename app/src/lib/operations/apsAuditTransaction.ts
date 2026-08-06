/**
 * Read-only transaction enforcement for the APS data-readiness audit (#284
 * PR A).
 *
 * Passing a Prisma transaction client to query functions instead of the
 * global `prisma` client is a *code-review convention*, not a real
 * boundary — the transaction client Prisma hands back from `$transaction`
 * still exposes every mutation method (`create`, `update`, `delete`,
 * `$executeRaw`, ...). The actual enforcement has to come from PostgreSQL
 * itself: `SET TRANSACTION READ ONLY`, issued as the very first statement
 * inside the transaction, makes every subsequent data-modification
 * statement fail at the database level regardless of what application code
 * attempts. See `apsDataReadinessAudit.integration.test.ts` for the
 * real-Postgres test that proves a representative write is rejected inside
 * this transaction.
 *
 * As defense in depth on top of that, the callback's result is smuggled out
 * via a thrown sentinel so the transaction is always rolled back, never
 * committed — even a successful read-only run leaves zero durable trace,
 * and a future bug that somehow bypassed READ ONLY would still be undone by
 * the rollback rather than committed.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

export type AuditTxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Generous enough for cross-alliance aggregate scans; bounded so a runaway query can never hang the audit indefinitely. */
export const DEFAULT_AUDIT_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Thrown internally to force Prisma to roll back the transaction while
 * still carrying the callback's result back to the caller. Never expected
 * to escape `runInReadOnlyAuditTransaction` — if it does, something is
 * wrong with the rollback plumbing itself, not with audit data.
 */
class AuditTransactionRollbackSignal<T> extends Error {
  constructor(public readonly result: T) {
    super("APS audit transaction rollback signal (expected control flow, not a real failure)");
    this.name = "AuditTransactionRollbackSignal";
  }
}

function isAuditTransactionRollbackSignal<T>(error: unknown): error is AuditTransactionRollbackSignal<T> {
  return error instanceof AuditTransactionRollbackSignal;
}

function assertSafeTimeoutMs(statementTimeoutMs: number): void {
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    throw new Error(`Invalid statement timeout: ${statementTimeoutMs}. Must be a positive integer number of milliseconds.`);
  }
}

/**
 * Runs `fn` inside a transaction that is read-only at the database level
 * before `fn` ever executes a single query, and that always rolls back.
 *
 * `SET TRANSACTION READ ONLY` and `SET LOCAL statement_timeout` are issued
 * as the first two statements of the transaction — before `fn` runs — so
 * there is no window in which `fn` could execute a query under read-write
 * semantics or an unbounded timeout.
 */
export async function runInReadOnlyAuditTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: AuditTxClient) => Promise<T>,
  options: { statementTimeoutMs?: number } = {},
): Promise<T> {
  const statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_AUDIT_STATEMENT_TIMEOUT_MS;
  assertSafeTimeoutMs(statementTimeoutMs);

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        // statementTimeoutMs is validated above to be a positive integer
        // before interpolation — SET does not accept bind parameters in the
        // Postgres wire protocol, so a validated-safe literal is used instead.
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);

        const result = await fn(tx);

        // Force a rollback of this read-only transaction even on success —
        // see the module doc comment for why.
        throw new AuditTransactionRollbackSignal(result);
      },
      { maxWait: 5_000, timeout: statementTimeoutMs + 5_000 },
    );

    // Unreachable: the callback above always throws.
    throw new Error("APS audit transaction completed without rolling back — this should never happen.");
  } catch (error) {
    if (isAuditTransactionRollbackSignal<T>(error)) {
      return error.result;
    }
    throw error;
  }
}
