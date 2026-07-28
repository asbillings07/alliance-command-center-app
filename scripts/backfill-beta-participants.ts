/**
 * Backfill BetaParticipant identity for legacy BetaInvitation rows (#174 PR 1b).
 *
 * MANUAL OPERATIONS SEQUENCE (do not skip):
 *   1. Merge and deploy Deployment A (PR 1a) — already on main.
 *   2. Merge and deploy THIS PR (scripts + contract migration file only).
 *   3. Operator runs THIS script against production (without --dry-run).
 *   4. Operator runs `npm run beta:validate-participants` against production
 *      and confirms all four checks return zero rows (exit code 0).
 *   5. ONLY THEN operator applies Deployment B contract migration:
 *      `npm run migrateProd` (or `prisma migrate deploy`).
 *
 * Merging this PR alone does NOT complete the rollout. The contract migration
 * must not be applied until steps 3–4 pass in production.
 *
 * Usage:
 *   npm run beta:backfill-participants           # dry run (default)
 *   npm run beta:backfill-participants -- --execute
 */

import "dotenv/config";
import { prisma } from "../app/src/lib/prisma";
import {
  countNullParticipantInvitations,
  runBetaParticipantBackfill,
} from "../app/src/lib/operations/betaParticipantBackfillDb";

function parseArgs(argv: string[]): { execute: boolean } {
  return { execute: argv.includes("--execute") };
}

async function main(): Promise<void> {
  const { execute } = parseArgs(process.argv.slice(2));
  const dryRun = !execute;

  const pending = await countNullParticipantInvitations(prisma);
  console.log(
    dryRun
      ? "DRY RUN — no writes will be performed. Pass --execute to apply."
      : "EXECUTE — backfill will write to the target database.",
  );
  console.log(`BetaInvitation rows with NULL participantId: ${pending}`);

  if (pending === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const summary = await runBetaParticipantBackfill(prisma, { dryRun });
  console.log("\nBackfill summary:");
  console.log(`  dryRun: ${summary.dryRun}`);
  console.log(`  emailsProcessed: ${summary.emailsProcessed}`);
  console.log(`  emailsSkipped: ${summary.emailsSkipped}`);
  console.log(`  invitationsAssigned: ${summary.invitationsAssigned}`);
  console.log(`  participantsCreated: ${summary.participantsCreated}`);
  console.log(`  mergesPerformed: ${summary.mergesPerformed}`);
  console.log(`  ambiguousFlagsSet: ${summary.ambiguousFlagsSet}`);

  if (dryRun) {
    console.log(
      "\nReview the dry-run summary, then re-run with --execute before validation.",
    );
  } else {
    const remaining = await countNullParticipantInvitations(prisma);
    console.log(`\nRemaining NULL participantId rows: ${remaining}`);
    console.log(
      "Next step: npm run beta:validate-participants (must exit 0 before migrate deploy).",
    );
  }
}

main()
  .catch((error) => {
    console.error("\nBackfill failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
