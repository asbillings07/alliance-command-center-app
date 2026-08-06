/**
 * APS data-readiness audit CLI (#284 PR A).
 *
 * Read-only evidence for the Alliance Performance Score discovery ADR
 * (#284) — see `docs/adr/017-alliance-performance-score-domain-model.md`
 * once written, and `app/src/lib/operations/apsDataReadinessAudit.ts` for
 * what this actually queries.
 *
 * Safety properties (do not weaken without updating ADR-017's evidence
 * section):
 *   - Requires an explicit, non-empty, comma-separated `--alliance-ids=`
 *     allowlist. NEVER defaults to "every alliance."
 *   - Requires `--yes-i-am-sure-this-is-<db-identity>` before running
 *     against anything but local dev, matching `validate-beta-participants.ts`.
 *   - The entire audit runs inside a transaction PostgreSQL itself enforces
 *     as read-only (`SET TRANSACTION READ ONLY`), not merely a Prisma
 *     transaction-client convention.
 *   - Prints ONLY the final, pseudonymized, small-cell-suppressed report.
 *     No raw query result, and no intermediate value, is ever printed,
 *     logged, or written to a file by this script.
 *
 * Usage:
 *   npm run aps:audit-data-readiness -- --alliance-ids=cln1...,cln2...
 *   npm run aps:audit-data-readiness -- --alliance-ids=cln1...,cln2... --yes-i-am-sure-this-is-<db-identity>
 */
import "dotenv/config";
import { prisma } from "../app/src/lib/prisma";
import { resolveBackfillTargetIdentity } from "../app/src/lib/operations/betaParticipantBackfillDb";
import { runInReadOnlyAuditTransaction } from "../app/src/lib/operations/apsAuditTransaction";
import { runApsDataReadinessAudit } from "../app/src/lib/operations/apsDataReadinessAudit";
import { formatApsDataReadinessAuditReport } from "../app/src/lib/operations/apsAuditReportFormat";

export function parseAuditArgs(argv: string[]): {
  allianceIds: string[];
  confirmIdentity: string | null;
} {
  let allianceIds: string[] = [];
  let confirmIdentity: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--alliance-ids=")) {
      allianceIds = arg
        .slice("--alliance-ids=".length)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      continue;
    }
    const identityMatch = arg.match(/^--yes-i-am-sure-this-is-(.+)$/);
    if (identityMatch) {
      confirmIdentity = identityMatch[1]!;
    }
  }

  return { allianceIds, confirmIdentity };
}

export function assertAuditTargetIdentity(
  confirmIdentity: string | null,
  target: ReturnType<typeof resolveBackfillTargetIdentity>,
): void {
  console.log(
    `Audit target database identity: ${target.identity} (host: ${target.hostname})${target.isProduction ? " — PRODUCTION" : ""}`,
  );
  if (target.isProduction && confirmIdentity !== target.identity) {
    throw new Error(
      `Refusing to audit a production database: pass --yes-i-am-sure-this-is-${target.identity} (exact database identity) ` +
        "so this evidence run is bound to the approved database. Local/dev databases do not require this flag.",
    );
  }
}

async function main(): Promise<void> {
  const args = parseAuditArgs(process.argv.slice(2));

  if (args.allianceIds.length === 0) {
    throw new Error(
      "Refusing to run: --alliance-ids=<id1,id2,...> is required and must be non-empty. " +
        "This audit never defaults to auditing every alliance — pass the exact, consented allowlist.",
    );
  }

  const target = resolveBackfillTargetIdentity();
  assertAuditTargetIdentity(args.confirmIdentity, target);

  const report = await runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, args.allianceIds));

  // The ONLY output this script ever produces. Do not add additional
  // logging of intermediate query results anywhere above this line.
  console.log(formatApsDataReadinessAuditReport(report));
}

main()
  .catch((error) => {
    console.error("\nAPS data-readiness audit failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
