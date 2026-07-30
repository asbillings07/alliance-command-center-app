/**
 * Backfill Feedback.allianceId and missing FeedbackTriage projections (#176 PR 1).
 *
 * Idempotent and safe to run multiple times. Supports --dry-run (default).
 *
 * Usage:
 *   npm run feedback:backfill-inbox
 *     # dry-run; writes ./feedback-inbox-backfill-manifest.json
 *   npm run feedback:backfill-inbox -- --execute \
 *     --manifest ./feedback-inbox-backfill-manifest.json \
 *     --yes-i-am-sure-this-is-<db-identity> \
 *     [--confirm-production]
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../app/src/lib/prisma";
import { productionIdentities } from "../app/src/lib/productionDb";
import {
  buildFeedbackInboxBackfillManifest,
  feedbackInboxBackfillManifestChecksumPayload,
  planFeedbackInboxBackfill,
  listFeedbackInboxBackfillRows,
  resolveBackfillTargetIdentity,
  runFeedbackInboxBackfill,
  validateFeedbackInboxBackfillManifestShape,
  verifyFeedbackInboxBackfillManifestForExecute,
  verifyFeedbackInboxBackfillManifestIntegrity,
} from "../app/src/lib/operations/feedbackInboxBackfillDb";

const DEFAULT_MANIFEST_PATH = "./feedback-inbox-backfill-manifest.json";

export type BackfillInboxCliArgs = {
  execute: boolean;
  confirmProduction: boolean;
  confirmIdentity: string | null;
  manifestPath: string;
};

export function parseBackfillInboxArgs(argv: string[]): BackfillInboxCliArgs {
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

export function assertBackfillInboxExecuteAllowed(
  args: BackfillInboxCliArgs,
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

export async function loadAndVerifyApprovedInboxManifest(
  manifestPath: string,
  dbIdentity: string,
) {
  const manifest = validateFeedbackInboxBackfillManifestShape(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const integrity = verifyFeedbackInboxBackfillManifestIntegrity(manifest);
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

function printSummary(
  summary: Awaited<ReturnType<typeof runFeedbackInboxBackfill>>,
): void {
  console.log("\nFeedback inbox backfill summary:");
  console.log(`  dryRun: ${summary.dryRun}`);
  console.log(`  totalFeedbackRows: ${summary.totalFeedbackRows}`);
  console.log(`  allianceIdUpdates: ${summary.allianceIdUpdates}`);
  console.log(`  allianceIdSkippedAlreadySet: ${summary.allianceIdSkippedAlreadySet}`);
  console.log(`  allianceIdSkippedNoSegment: ${summary.allianceIdSkippedNoSegment}`);
  console.log(`  triageProjectionsCreated: ${summary.triageProjectionsCreated}`);
  console.log(`  triageProjectionsSkippedExisting: ${summary.triageProjectionsSkippedExisting}`);
  if (!summary.dryRun) {
    console.log(`  allianceIdApplied: ${summary.allianceIdApplied}`);
    console.log(`  triageProjectionsApplied: ${summary.triageProjectionsApplied}`);
    console.log(`  validationOk: ${summary.validation.ok}`);
    if (summary.validation.violations.length > 0) {
      console.log(`  validationViolations: ${summary.validation.violations.join("; ")}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseBackfillInboxArgs(process.argv.slice(2));
  const dryRun = !args.execute;
  const target = resolveBackfillTargetIdentity();

  assertBackfillInboxExecuteAllowed(args, target);

  console.log(
    dryRun
      ? "DRY RUN — no writes will be performed. Pass --execute with identity confirmation to apply."
      : "EXECUTE — backfill will write to the target database.",
  );

  if (dryRun) {
    const rows = await listFeedbackInboxBackfillRows(prisma);
    const plan = planFeedbackInboxBackfill(rows);
    const summary = await runFeedbackInboxBackfill(prisma, { dryRun: true });
    printSummary(summary);

    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity: target.identity,
      totalFeedbackRows: rows.length,
      plan,
    });
    writeFileSync(args.manifestPath, JSON.stringify(manifest, null, 2));
    console.log(
      `\nWrote reviewed dry-run manifest to ${args.manifestPath} (checksum ${manifest.checksum.slice(0, 12)}...).`,
    );
    console.log(
      `Re-run with --execute --manifest ${args.manifestPath} --yes-i-am-sure-this-is-${target.identity}${target.isProduction ? " --confirm-production" : ""} after review.`,
    );
    return;
  }

  const manifest = await loadAndVerifyApprovedInboxManifest(
    args.manifestPath,
    target.identity,
  );
  console.log(
    `\nLoaded reviewed manifest: ${args.manifestPath} (generated ${manifest.generatedAt})`,
  );

  const rows = await listFeedbackInboxBackfillRows(prisma);
  const plan = planFeedbackInboxBackfill(rows);
  const verdict = verifyFeedbackInboxBackfillManifestForExecute(
    manifest,
    {
      dbIdentity: target.identity,
      payload: feedbackInboxBackfillManifestChecksumPayload({
        dbIdentity: target.identity,
        totalFeedbackRows: rows.length,
        plan,
      }),
    },
    rows,
  );
  if (!verdict.ok) {
    throw new Error(`Refusing to execute: ${verdict.reason}`);
  }

  const summary = await runFeedbackInboxBackfill(prisma, {
    dryRun: false,
    approvedManifest: manifest,
  });
  printSummary(summary);

  if (!summary.validation.ok) {
    throw new Error(
      `Post-run validation failed: ${summary.validation.violations.join("; ")}`,
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
