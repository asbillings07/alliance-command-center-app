/**
 * Backfill Feedback.allianceId and missing FeedbackTriage projections (#176 PR 1).
 *
 * Idempotent and safe to run multiple times. Supports --dry-run (default).
 *
 * Usage:
 *   npm run feedback:backfill-inbox
 *   npm run feedback:backfill-inbox -- --execute
 */

import "dotenv/config";
import { prisma } from "../app/src/lib/prisma";
import { runFeedbackInboxBackfill } from "../app/src/lib/operations/feedbackInboxBackfillDb";

export type BackfillInboxCliArgs = {
  execute: boolean;
};

export function parseBackfillInboxArgs(argv: string[]): BackfillInboxCliArgs {
  return {
    execute: argv.includes("--execute"),
  };
}

function printSummary(summary: Awaited<ReturnType<typeof runFeedbackInboxBackfill>>): void {
  console.log("\nFeedback inbox backfill summary:");
  console.log(`  dryRun: ${summary.dryRun}`);
  console.log(`  totalFeedbackRows: ${summary.totalFeedbackRows}`);
  console.log(`  allianceIdUpdates: ${summary.allianceIdUpdates}`);
  console.log(`  allianceIdSkippedAlreadySet: ${summary.allianceIdSkippedAlreadySet}`);
  console.log(`  allianceIdSkippedNoSegment: ${summary.allianceIdSkippedNoSegment}`);
  console.log(`  triageProjectionsCreated: ${summary.triageProjectionsCreated}`);
  console.log(`  triageProjectionsSkippedExisting: ${summary.triageProjectionsSkippedExisting}`);
}

async function main(): Promise<void> {
  const args = parseBackfillInboxArgs(process.argv.slice(2));
  const dryRun = !args.execute;

  console.log(
    dryRun
      ? "DRY RUN — no writes will be performed. Pass --execute to apply."
      : "EXECUTE — backfill will write to the target database.",
  );

  const summary = await runFeedbackInboxBackfill(prisma, { dryRun });
  printSummary(summary);

  if (dryRun && summary.allianceIdUpdates + summary.triageProjectionsCreated > 0) {
    console.log("\nRe-run with --execute to apply the planned changes.");
  }
}

main()
  .catch((error) => {
    console.error(
      "\nBackfill failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
