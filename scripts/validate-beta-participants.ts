/**
 * Validate beta participant invariants before Deployment B (#174 PR 1b).
 *
 * MANUAL OPERATIONS SEQUENCE (do not skip):
 *   1. Deploy PR 1a (expand + dual-write).
 *   2. Deploy this PR (scripts + contract migration file).
 *   3. Run `npm run beta:backfill-participants -- --execute` in production.
 *   4. Run THIS script in production — all four checks must return zero rows
 *      (exit code 0) before proceeding.
 *   5. ONLY THEN apply the contract migration via `npm run migrateProd`.
 *
 * Exit code 0 = safe to apply contract migration. Non-zero = halt rollout.
 *
 * Usage:
 *   npm run beta:validate-participants
 */

import "dotenv/config";
import { prisma } from "../app/src/lib/prisma";
import {
  formatValidationReport,
  runAllBetaParticipantValidationChecks,
} from "../app/src/lib/operations/betaParticipantValidation";

async function main(): Promise<void> {
  const results = await runAllBetaParticipantValidationChecks(prisma);
  console.log(formatValidationReport(results));

  const failing = results.filter((result) => result.rows.length > 0);
  if (failing.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(
      "\nValidation failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
