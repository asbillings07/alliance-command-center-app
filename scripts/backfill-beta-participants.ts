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
 *     email group, assignment, merge, and ambiguous flag the operator approved.
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
 *     --manifest ./beta-backfill-manifest.json \
 *     --yes-i-am-sure-this-is-<db-identity> \
 *     [--confirm-production]
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../app/src/lib/prisma";
import { productionIdentities } from "../app/src/lib/productionDb";
import {
  backfillManifestChecksumPayload,
  buildBackfillManifest,
  countNullParticipantInvitations,
  resolveBackfillManifestPayload,
  resolveBackfillTargetIdentity,
  runBetaParticipantBackfill,
  validateBackfillManifestShape,
  verifyBackfillManifest,
  verifyBackfillManifestIntegrity,
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
  let manifestPath = DEFAULT_MANIFEST_PATH;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const identityMatch = arg.match(/^--yes-i-am-sure-this-is-(.+)$/);
    if (identityMatch) {
      confirmIdentity = identityMatch[1]!;
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = argv[i + 1] ?? DEFAULT_MANIFEST_PATH;
      i += 1;
    }
  }
  return {
    execute: argv.includes("--execute"),
    confirmProduction: argv.includes("--confirm-production"),
    confirmIdentity,
    manifestPath,
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

export async function loadAndVerifyApprovedManifest(
  manifestPath: string,
  dbIdentity: string,
) {
  const manifest = validateBackfillManifestShape(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const integrity = verifyBackfillManifestIntegrity(manifest);
  if (!integrity.ok) {
    throw new Error(`Refusing to execute: ${integrity.reason}`);
  }
  if (manifest.dbIdentity !== dbIdentity) {
    throw new Error(
      `Refusing to execute: manifest was generated for database "${manifest.dbIdentity}" but the current target is "${dbIdentity}".`,
    );
  }
  return manifest;
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

  if (dryRun) {
    const summary = await runBetaParticipantBackfill(prisma, { dryRun: true });
    console.log("\nBackfill summary (exhaustive over all affected email groups):");
    console.log(`  dryRun: ${summary.dryRun}`);
    console.log(`  emailGroupsPlanned: ${summary.emailPlans.length}`);
    console.log(`  emailsProcessed: ${summary.emailsProcessed}`);
    console.log(`  emailsSkipped: ${summary.emailsSkipped}`);
    console.log(`  invitationsAssigned: ${summary.invitationsAssigned}`);
    console.log(`  participantsCreated: ${summary.participantsCreated}`);
    console.log(`  mergesPerformed: ${summary.mergesPerformed}`);
    console.log(`  ambiguousFlagsSet: ${summary.ambiguousFlagsSet}`);

    const manifest = buildBackfillManifest({
      dbIdentity: target.identity,
      pendingNullInvitationCount: pending,
      emailPlans: summary.planRecords,
      totals: {
        emailsProcessed: summary.emailsProcessed,
        emailsSkipped: summary.emailsSkipped,
        invitationsAssigned: summary.invitationsAssigned,
        participantsCreated: summary.participantsCreated,
        mergesPerformed: summary.mergesPerformed,
        ambiguousFlagsSet: summary.ambiguousFlagsSet,
      },
    });
    writeFileSync(args.manifestPath, JSON.stringify(manifest, null, 2));
    console.log(
      `\nWrote reviewed dry-run manifest to ${args.manifestPath} (checksum ${manifest.checksum.slice(0, 12)}...).`,
    );
    console.log(
      `Re-run with --execute --manifest ${args.manifestPath} --yes-i-am-sure-this-is-${target.identity}${target.isProduction ? " --confirm-production" : ""} after review.`,
    );
    console.log(
      "Recovery: see script header — manifest + Neon PITR (docs/operations/backups.md).",
    );
    return;
  }

  const manifest = await loadAndVerifyApprovedManifest(
    args.manifestPath,
    target.identity,
  );
  console.log(
    `\nLoaded reviewed manifest: ${args.manifestPath} (generated ${manifest.generatedAt})`,
  );

  const fresh = await resolveBackfillManifestPayload(prisma);
  const verdict = verifyBackfillManifest(manifest, {
    dbIdentity: target.identity,
    payload: backfillManifestChecksumPayload({
      dbIdentity: target.identity,
      pendingNullInvitationCount: fresh.pendingNullInvitationCount,
      emailPlans: fresh.emailPlans,
      totals: fresh.totals,
    }),
  });
  if (!verdict.ok) {
    throw new Error(`Refusing to execute: ${verdict.reason}`);
  }

  const summary = await runBetaParticipantBackfill(prisma, {
    dryRun: false,
    approvedManifest: manifest,
  });
  console.log("\nBackfill execute summary:");
  console.log(`  emailGroupsApplied: ${summary.emailPlans.length}`);
  console.log(`  invitationsAssigned: ${summary.invitationsAssigned}`);
  console.log(`  participantsCreated: ${summary.participantsCreated}`);
  console.log(`  mergesPerformed: ${summary.mergesPerformed}`);
  console.log(`  ambiguousFlagsSet: ${summary.ambiguousFlagsSet}`);

  const remaining = await countNullParticipantInvitations(prisma);
  console.log(`\nRemaining NULL participantId rows: ${remaining}`);
  console.log(
    `Next step: npm run beta:validate-participants -- --yes-i-am-sure-this-is-${target.identity} (must exit 0 before PR 1c contract deploy).`,
  );
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
