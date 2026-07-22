#!/usr/bin/env tsx
/**
 * Beta data cleanup (issue #161).
 *
 * Removes test/smoke data from a target database through a reviewed,
 * manifest-bound, transactional operation. DRY RUN IS THE DEFAULT: without
 * --execute this only reads, prints an inventory + the proposed plan, and
 * writes a manifest for review.
 *
 * This file is a thin CLI: argument parsing lives in
 * `app/src/lib/operations/betaCleanup.ts` (pure, no DB access) and the
 * database orchestration (plan resolution, transactional execute, --verify)
 * lives in `app/src/lib/operations/betaCleanupDb.ts` — split out specifically
 * so it's directly importable by a real-Postgres integration test.
 *
 * Safety model:
 *   - The manifest's checksum is never trusted to authenticate `manifest.ops`
 *     directly. Execution instead RE-RESOLVES the plan live from the database
 *     (inside the same transaction) and only proceeds if that fresh plan's
 *     checksum matches the manifest's — so a hand-edited manifest file cannot
 *     smuggle in an extra id; only the live database determines what runs.
 *   - Re-resolution, verification, and execution all happen inside ONE
 *     Serializable transaction holding a PostgreSQL advisory lock, so no
 *     concurrent cleanup run or application write can interleave.
 *   - Every operation's affected row count (delete AND nullify/revoke) is
 *     checked against the reviewed plan INSIDE the transaction; any mismatch
 *     throws and rolls back before anything commits.
 *   - `--execute` requires the exact phrase `EXECUTION_CONFIRMATION_PHRASE`
 *     via `--confirm`, independent of environment, plus `--confirm-production`
 *     when the target resolves to the production database identity.
 *   - Tenant deletion (--alliance-id) and user deletion (--user-email) are
 *     separate. `--keep-user-email` / `--keep-alliance-id` are enforced (not
 *     just recorded): any overlap with the target selection, or any keep-listed
 *     row appearing in the resolved plan, aborts before anything runs.
 *   - EVERY explicit target/keep id or email that doesn't resolve to an
 *     existing row (typo, already deleted, etc.) fails closed — the run
 *     aborts rather than silently proceeding with a smaller plan than the
 *     operator asked for. This applies uniformly to --user-email,
 *     --keep-user-email, --keep-alliance-id, --access-request-ids, and
 *     --feedback-ids.
 *   - The target database identity is resolved with the SAME resolver the app
 *     uses (app/src/lib/productionDb), so the tool and the app can never
 *     disagree about which database is production.
 *   - Age-based staleness (invitations) uses a cutoff FROZEN into the manifest
 *     at dry-run time and reused verbatim at execute time, so the boundary
 *     never drifts between review and execution.
 *   - Feedback and AccessRequest are cleaned only by EXPLICIT id, never by
 *     age — this is an intentional design choice (these categories need human
 *     judgment, not an age heuristic), not a gap. Invitations are revoked
 *     (audit-preserving), not deleted.
 *   - `--verify` independently confirms delete/nullify/revoke targets are
 *     fully applied, AND that nullify/revoke targets still EXIST (a row
 *     unexpectedly deleted entirely would otherwise vacuously pass a
 *     "field is null" check).
 *
 * Usage (dry run):
 *   npx tsx scripts/cleanup-beta-data.ts \
 *     --alliance-id <id> --user-email test@example.com \
 *     --keep-user-email you@you.com --keep-alliance-id <smoke-alliance> \
 *     --include-expired-reset-tokens --manifest ./beta-cleanup-manifest.json
 *
 * Execute the reviewed manifest (same selection flags, plus the confirmation
 * phrase printed by the dry run):
 *   npx tsx scripts/cleanup-beta-data.ts --execute --confirm-production \
 *     --confirm "DELETE BETA DATA" \
 *     --manifest ./beta-cleanup-manifest.json <same selection flags>
 *
 * Independently audit that a manifest's operations were actually applied:
 *   npx tsx scripts/cleanup-beta-data.ts --verify --manifest ./beta-cleanup-manifest.json
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../app/src/lib/prisma";
import { productionIdentities } from "../app/src/lib/productionDb";
import {
  parseArgs,
  buildManifest,
  validateManifestShape,
  verifyManifestIntegrity,
  validateSelectionOverlaps,
  summarizePlan,
  summarizeDeletes,
  EXECUTION_CONFIRMATION_PHRASE,
  type CleanupOp,
} from "../app/src/lib/operations/betaCleanup";
import {
  resolveTargetIdentity,
  inventory,
  buildPlan,
  assertSafeSelection,
  execute,
  runVerify,
} from "../app/src/lib/operations/betaCleanupDb";

function printInventory(label: string, counts: Record<string, number>): void {
  console.log(`\n${label}`);
  for (const [model, n] of Object.entries(counts)) {
    console.log(`  ${model.padEnd(20)} ${n}`);
  }
}

function printPlan(plan: CleanupOp[]): void {
  if (plan.length === 0) {
    console.log("\nPlan is EMPTY — nothing selected.");
    return;
  }
  console.log("\nProposed plan (in execution order):");
  for (const step of summarizePlan(plan)) {
    const verb =
      step.kind === "delete"
        ? "DELETE"
        : step.kind === "nullify"
          ? `NULL   ${step.field}`
          : `REVOKE ${step.field}`;
    console.log(`  ${verb.padEnd(22)} ${String(step.count).padStart(5)}  ${step.model}  — ${step.reason}`);
  }
  console.log("\nRows to delete by model:", JSON.stringify(summarizeDeletes(plan)));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.verify) {
    const result = await runVerify(args.manifestPath);
    for (const line of result.lines) {
      (line.startsWith("FAIL") ? console.error : console.log)(line);
    }
    if (!result.ok) {
      console.error(`\nVerification FAILED: ${result.failures} operation(s) did not fully apply.`);
      process.exitCode = 1;
    } else {
      console.log(`\nVerification PASSED: all recorded operations were fully applied.`);
    }
    return;
  }

  const { identity, isProduction } = resolveTargetIdentity();
  console.log(`Target database identity: ${identity}${isProduction ? " (PRODUCTION)" : ""}`);

  if (args.execute) {
    if (productionIdentities(process.env.PRODUCTION_DB_HOSTS).length === 0) {
      throw new Error(
        "Refusing to --execute: set PRODUCTION_DB_HOSTS so the tool can recognize the production database."
      );
    }
    if (isProduction && !args.confirmProduction) {
      throw new Error("Refusing to --execute against PRODUCTION without --confirm-production.");
    }
    if (args.confirmPhrase !== EXECUTION_CONFIRMATION_PHRASE) {
      throw new Error(
        `Refusing to --execute: pass --confirm "${EXECUTION_CONFIRMATION_PHRASE}" (exact phrase) to proceed.`
      );
    }

    const overlaps = validateSelectionOverlaps(args);
    if (overlaps.length > 0) {
      throw new Error(`Refusing to execute: ${overlaps.join("; ")}`);
    }

    const manifest = validateManifestShape(JSON.parse(readFileSync(args.manifestPath, "utf8")));
    const integrity = verifyManifestIntegrity(manifest);
    if (!integrity.ok) {
      throw new Error(`Refusing to execute: ${integrity.reason}`);
    }

    console.log(`\nExecuting reviewed manifest: ${args.manifestPath} (generated ${manifest.generatedAt})`);
    const deleteCounts = await execute(args, manifest, identity);
    console.log("\nExecution complete (transaction committed). Deleted rows by model:", JSON.stringify(deleteCounts));
    console.log(`Run with --verify --manifest ${args.manifestPath} to independently confirm every operation applied.`);

    printInventory("Inventory (after):", await inventory(prisma));
    return;
  }

  // Dry run (default): read-only. Inventory + plan + manifest for review.
  printInventory("Inventory (before):", await inventory(prisma));

  const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });

  assertSafeSelection(args, fresh);

  printPlan(fresh.plan);

  const manifest = buildManifest({
    cutoff: fresh.cutoff,
    dbIdentity: identity,
    keep: { userEmails: args.keepUserEmails, allianceIds: args.keepAllianceIds },
    plan: fresh.plan,
  });
  writeFileSync(args.manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDRY RUN. Wrote manifest to ${args.manifestPath} (checksum ${manifest.checksum.slice(0, 12)}...).`);
  console.log(
    `Review it, then re-run with --execute${isProduction ? " --confirm-production" : ""} --confirm "${EXECUTION_CONFIRMATION_PHRASE}" and the SAME flags.`
  );
}

main()
  .catch((error) => {
    console.error("\nError:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
