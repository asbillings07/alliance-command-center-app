/**
 * APS data-readiness audit CLI (#284 PR A).
 *
 * Read-only evidence for the Alliance Performance Score discovery ADR
 * (#284) -- see `docs/adr/017-alliance-performance-score-domain-model.md`
 * once written, and `app/src/lib/operations/apsDataReadinessAudit.ts` for
 * what this actually queries.
 *
 * This is a thin entrypoint only -- `parseAuditArgs`/`assertAuditTargetIdentity`
 * live in `app/src/lib/operations/apsAuditCli.ts` (import-safe, unit-tested
 * under `npm run test:unit`) so nothing here needs to be imported by a test.
 *
 * Safety properties (do not weaken without updating ADR-017's evidence
 * section):
 *   - Requires an explicit, non-empty, comma-separated `--alliance-ids=`
 *     allowlist. NEVER defaults to "every alliance."
 *   - Requires `--yes-i-am-sure-this-is-<db-identity>` for every database
 *     target not positively identified as local (see `apsAuditCli.ts` --
 *     this fails closed even if `PRODUCTION_DB_HOSTS` is unset/incomplete).
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
 *
 * To look up the confirmation string for a non-local `DATABASE_URL`, run
 * `npx tsx scripts/show-aps-audit-target-identity.ts` -- a wholly separate,
 * minimal script that writes the identity to a local file (never to
 * stdout/stderr) and cannot construct or connect a database client by
 * construction of its import graph. This script never discloses identity
 * itself, on any path, including the refusal error below.
 */
import "dotenv/config";
import { prisma } from "../app/src/lib/prisma";
import { resolveBackfillTargetIdentity } from "../app/src/lib/operations/betaParticipantBackfillDb";
import { parseAuditArgs, assertAuditTargetIdentity } from "../app/src/lib/operations/apsAuditCli";
import { runInReadOnlyAuditTransaction } from "../app/src/lib/operations/apsAuditTransaction";
import { runApsDataReadinessAudit } from "../app/src/lib/operations/apsDataReadinessAudit";
import { formatApsDataReadinessAuditReport } from "../app/src/lib/operations/apsAuditReportFormat";

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

  const report = await runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, args.allianceIds), {
    allianceCount: args.allianceIds.length,
  });

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
