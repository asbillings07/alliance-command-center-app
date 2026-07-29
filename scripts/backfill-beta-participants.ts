/**
 * Backfill BetaParticipant identity for legacy BetaInvitation rows (#174 PR 1b).
 *
 * This PR ships NO Prisma migration. Per ADR-011, every Vercel build runs
 * `prisma generate -> prisma migrate deploy -> next build`; omitting the contract
 * migration from this deploy avoids auto-applying NOT NULL/unique constraints
 * before the manual gate runs.
 *
 * MANUAL OPERATIONS SEQUENCE (do not skip):
 *   1. Deployment A (PR 1a) — already on main.
 *   2. Merge and deploy THIS PR (backfill + validation scripts only).
 *   3. Operator runs dry-run, reviews the manifest, then executes against production.
 *   4. Operator runs `npm run beta:validate-participants` — must exit 0.
 *   5. Merge and deploy PR 1c (contract migration) only after step 4 passes on
 *      both production and preview databases.
 *
 * RECOVERY if execution was wrong or needs undo:
 *   - The dry-run manifest (written by default) is the reviewed record of every
 *     email group, assignment count, merge, and ambiguous flag the operator approved.
 *   - There is no automatic undo: participant merges/deletes are destructive.
 *   - Preferred recovery: Neon point-in-time recovery (PITR) — see
 *     docs/operations/backups.md. Restore to a branch/snapshot from immediately
 *     before the `--execute` run, then re-run dry-run against the restored database.
 *   - Re-running `--execute` is idempotent on already-backfilled rows but cannot
 *     reverse merges/deletes from a prior run.
 *
 * Usage:
 *   npm run beta:backfill-participants
 *     # exhaustive dry-run; writes ./beta-backfill-manifest.json
 *   npm run beta:backfill-participants -- --execute \
 *     --yes-i-am-sure-this-is-<db-identity> \
 *     [--confirm-production]
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../app/src/lib/prisma";
import { productionIdentities } from "../app/src/lib/productionDb";
import {
  buildBackfillManifest,
  countNullParticipantInvitations,
  resolveBackfillTargetIdentity,
  runBetaParticipantBackfill,
} from "../app/src/lib/operations/betaParticipantBackfillDb";

const DEFAULT_MANIFEST_PATH = "./beta-backfill-manifest.json";

export type BackfillCliArgs = {
  execute: boolean;
  confirmProduction: boolean;
  confirmIdentity: string | null;
  manifestPath: string;
};

export function parseBackfillArgs(argv: string[]): BackfillCliArgs {
  let confirmIdentity: string | null = null;
  for (const arg of argv) {
    const match = arg.match(/^--yes-i-am-sure-this-is-(.+)$/);
    if (match) {
      confirmIdentity = match[1]!;
    }
  }
  return {
    execute: argv.includes("--execute"),
    confirmProduction: argv.includes("--confirm-production"),
    confirmIdentity,
    manifestPath: DEFAULT_MANIFEST_PATH,
  };
}

export function assertBackfillExecuteAllowed(
  args: BackfillCliArgs,
  target: ReturnType<typeof resolveBackfillTargetIdentity>,
): void {
  if (!args.execute) {
    return;
  }

  if (productionIdentities(process.env.PRODUCTION_DB_HOSTS).length === 0) {
    throw new Error(
      "Refusing to --execute: set PRODUCTION_DB_HOSTS so the script can recognize the production database.",
    );
  }

  console.log(
    `Target database identity: ${target.identity} (host: ${target.hostname})${target.isProduction ? " — PRODUCTION" : ""}`,
  );

  if (target.isProduction && !args.confirmProduction) {
    throw new Error(
      "Refusing to --execute against PRODUCTION without --confirm-production.",
    );
  }

  if (args.confirmIdentity !== target.identity) {
    throw new Error(
      `Refusing to --execute: pass --yes-i-am-sure-this-is-${target.identity} (exact database identity) to proceed.`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const dryRun = !args.execute;
  const target = resolveBackfillTargetIdentity();

  assertBackfillExecuteAllowed(args, target);

  const pending = await countNullParticipantInvitations(prisma);
  console.log(
    dryRun
      ? "DRY RUN — no writes will be performed. Pass --execute with identity confirmation to apply."
      : "EXECUTE — backfill will write to the target database.",
  );
  console.log(`BetaInvitation rows with NULL participantId: ${pending}`);

  if (pending === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const summary = await runBetaParticipantBackfill(prisma, { dryRun });
  console.log("\nBackfill summary (exhaustive over all affected email groups):");
  console.log(`  dryRun: ${summary.dryRun}`);
  console.log(`  emailGroupsPlanned: ${summary.emailPlans.length}`);
  console.log(`  emailsProcessed: ${summary.emailsProcessed}`);
  console.log(`  emailsSkipped: ${summary.emailsSkipped}`);
  console.log(`  invitationsAssigned: ${summary.invitationsAssigned}`);
  console.log(`  participantsCreated: ${summary.participantsCreated}`);
  console.log(`  mergesPerformed: ${summary.mergesPerformed}`);
  console.log(`  ambiguousFlagsSet: ${summary.ambiguousFlagsSet}`);

  if (dryRun) {
    const manifest = buildBackfillManifest({
      dbIdentity: target.identity,
      pendingNullInvitationCount: pending,
      summary,
    });
    writeFileSync(args.manifestPath, JSON.stringify(manifest, null, 2));
    console.log(
      `\nWrote reviewed dry-run manifest to ${args.manifestPath} (checksum ${manifest.checksum.slice(0, 12)}...).`,
    );
    console.log(
      `Re-run with --execute --yes-i-am-sure-this-is-${target.identity}${target.isProduction ? " --confirm-production" : ""} after review.`,
    );
    console.log(
      "Recovery: see script header — manifest + Neon PITR (docs/operations/backups.md).",
    );
  } else {
    const remaining = await countNullParticipantInvitations(prisma);
    console.log(`\nRemaining NULL participantId rows: ${remaining}`);
    console.log(
      "Next step: npm run beta:validate-participants (must exit 0 before PR 1c contract deploy).",
    );
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
