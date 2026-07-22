#!/usr/bin/env tsx
/**
 * Beta data cleanup (issue #161).
 *
 * Removes test/smoke data from a target database through a reviewed,
 * manifest-bound, transactional operation. DRY RUN IS THE DEFAULT: without
 * --execute this only reads, prints an inventory + the proposed plan, and
 * writes a manifest for review.
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
 *     Unresolved keep-list emails fail closed (never silently ignored).
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
import { Prisma } from "../app/generated/prisma/client";
import { prisma } from "../app/src/lib/prisma";
import { connectionIdentity, productionIdentities } from "../app/src/lib/productionDb";
import {
  parseArgs,
  assembleTenantPlan,
  assembleUserPlan,
  mergePlans,
  buildManifest,
  toChecksumPayload,
  verifyManifest,
  verifyManifestIntegrity,
  validateManifestShape,
  validateSelectionOverlaps,
  summarizePlan,
  summarizeDeletes,
  summarizeOpCounts,
  planOpKey,
  resolveCutoffDate,
  keepListViolations,
  allianceKeepListViolations,
  EXECUTION_CONFIRMATION_PHRASE,
  type CleanupArgs,
  type CleanupOp,
  type CleanupModel,
  type TenantResolved,
  type UserResolved,
  type CleanupManifest,
} from "../app/src/lib/operations/betaCleanup";

/** Deterministic key so concurrent runs serialize (transaction-scoped). */
const ADVISORY_LOCK_KEY = 8161161161161161;

const DELEGATE: Record<CleanupModel, string> = {
  PasswordResetToken: "passwordResetToken",
  EmailChangeRequest: "emailChangeRequest",
  MemberMetricEntry: "memberMetricEntry",
  LeadershipNote: "leadershipNote",
  Invitation: "invitation",
  MetricPeriodMetric: "metricPeriodMetric",
  Metric: "metric",
  MetricPeriod: "metricPeriod",
  AllianceMember: "allianceMember",
  AllianceMembership: "allianceMembership",
  BetaInvitation: "betaInvitation",
  Feedback: "feedback",
  AccessRequest: "accessRequest",
  Alliance: "alliance",
  User: "user",
};

// The Prisma client/transaction client is intentionally accessed dynamically
// by delegate name, and interchangeably as either the top-level client (dry
// run, --verify) or an interactive-transaction client (--execute).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

function ids<T extends { id: string }>(rows: T[]): string[] {
  return rows.map((r) => r.id);
}

function resolveTargetIdentity(): { identity: string; isProduction: boolean } {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required.");
  const identity = connectionIdentity(dbUrl);
  const directUrl = process.env.DIRECT_URL;
  if (directUrl && connectionIdentity(directUrl) !== identity) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL resolve to different databases; refusing to run."
    );
  }
  const allow = productionIdentities(process.env.PRODUCTION_DB_HOSTS);
  return { identity, isProduction: allow.includes(identity) };
}

async function inventory(db: Db): Promise<Record<string, number>> {
  const [
    users,
    alliances,
    members,
    memberships,
    invitations,
    betaInvitations,
    feedback,
    accessRequests,
    resetTokens,
    emailChanges,
    metrics,
    metricPeriods,
    metricPeriodMetrics,
    memberMetricEntries,
    leadershipNotes,
  ] = await Promise.all([
    db.user.count(),
    db.alliance.count(),
    db.allianceMember.count(),
    db.allianceMembership.count(),
    db.invitation.count(),
    db.betaInvitation.count(),
    db.feedback.count(),
    db.accessRequest.count(),
    db.passwordResetToken.count(),
    db.emailChangeRequest.count(),
    db.metric.count(),
    db.metricPeriod.count(),
    db.metricPeriodMetric.count(),
    db.memberMetricEntry.count(),
    db.leadershipNote.count(),
  ]);
  return {
    User: users,
    Alliance: alliances,
    AllianceMember: members,
    AllianceMembership: memberships,
    Invitation: invitations,
    BetaInvitation: betaInvitations,
    Feedback: feedback,
    AccessRequest: accessRequests,
    PasswordResetToken: resetTokens,
    EmailChangeRequest: emailChanges,
    Metric: metrics,
    MetricPeriod: metricPeriods,
    MetricPeriodMetric: metricPeriodMetrics,
    MemberMetricEntry: memberMetricEntries,
    LeadershipNote: leadershipNotes,
  };
}

async function resolveTenant(db: Db, allianceId: string): Promise<TenantResolved> {
  const [members, entries, notes, invitations, periods, metrics, periodMetrics, memberships, betaInvitations] =
    await Promise.all([
      db.allianceMember.findMany({ where: { allianceId }, select: { id: true } }),
      db.memberMetricEntry.findMany({ where: { allianceMember: { allianceId } }, select: { id: true } }),
      db.leadershipNote.findMany({ where: { allianceMember: { allianceId } }, select: { id: true } }),
      db.invitation.findMany({ where: { allianceId }, select: { id: true } }),
      db.metricPeriod.findMany({ where: { allianceId }, select: { id: true } }),
      db.metric.findMany({ where: { allianceId }, select: { id: true } }),
      db.metricPeriodMetric.findMany({
        where: { period: { allianceId } },
        select: { periodId: true, metricId: true },
      }),
      db.allianceMembership.findMany({ where: { allianceId }, select: { id: true } }),
      db.betaInvitation.findMany({ where: { allianceId }, select: { id: true } }),
    ]);
  return {
    allianceId,
    allianceMemberIds: ids(members),
    memberMetricEntryIds: ids(entries),
    leadershipNoteIds: ids(notes),
    invitationIds: ids(invitations),
    metricPeriodIds: ids(periods),
    metricIds: ids(metrics),
    metricPeriodMetricKeys: periodMetrics.map((pm: { periodId: string; metricId: string }) => `${pm.periodId}::${pm.metricId}`),
    allianceMembershipIds: ids(memberships),
    betaInvitationIds: ids(betaInvitations),
  };
}

async function resolveUser(db: Db, userId: string): Promise<UserResolved> {
  const [resetTokens, emailChanges, feedback, notes, sent, accepted, betaAccepted, linkedMembers, memberships] =
    await Promise.all([
      db.passwordResetToken.findMany({ where: { userId }, select: { id: true } }),
      db.emailChangeRequest.findMany({ where: { userId }, select: { id: true } }),
      db.feedback.findMany({ where: { userId }, select: { id: true } }),
      db.leadershipNote.findMany({ where: { authorId: userId }, select: { id: true } }),
      db.invitation.findMany({ where: { invitedById: userId }, select: { id: true } }),
      db.invitation.findMany({ where: { acceptedByUserId: userId }, select: { id: true } }),
      db.betaInvitation.findMany({ where: { acceptedByUserId: userId }, select: { id: true } }),
      db.allianceMember.findMany({ where: { userId }, select: { id: true } }),
      db.allianceMembership.findMany({ where: { userId }, select: { id: true } }),
    ]);
  return {
    userId,
    passwordResetTokenIds: ids(resetTokens),
    emailChangeRequestIds: ids(emailChanges),
    feedbackIds: ids(feedback),
    leadershipNoteIds: ids(notes),
    invitationSentIds: ids(sent),
    invitationAcceptedIds: ids(accepted),
    betaInvitationAcceptedIds: ids(betaAccepted),
    allianceMemberLinkedIds: ids(linkedMembers),
    allianceMembershipIds: ids(memberships),
  };
}

/**
 * `frozenCutoff`: pass `null` on a dry run (compute a fresh cutoff from
 * `cutoffDays`); pass the manifest's own recorded `cutoff` on execute, so the
 * age-based boundary is byte-for-byte identical to what was reviewed.
 */
async function resolveStaleOps(
  db: Db,
  args: CleanupArgs,
  opts: { now: Date; frozenCutoff: string | null }
): Promise<{ ops: CleanupOp[]; cutoff: string | null }> {
  const usesCutoff = args.stale.betaInvitations || args.stale.invitations;
  const cutoffDate = usesCutoff
    ? resolveCutoffDate({ cutoffDays: args.cutoffDays, frozenCutoffIso: opts.frozenCutoff, now: opts.now })
    : opts.now;
  const cutoffUsed = usesCutoff ? cutoffDate.toISOString() : null;
  const ops: CleanupOp[] = [];

  if (args.stale.expiredResetTokens) {
    const rows = await db.passwordResetToken.findMany({
      where: { OR: [{ expiresAt: { lt: opts.now } }, { usedAt: { not: null } }] },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "PasswordResetToken", ids: ids(rows), reason: "expired or consumed reset token" });
  }

  if (args.stale.consumedEmailChanges) {
    const rows = await db.emailChangeRequest.findMany({
      where: { OR: [{ expiresAt: { lt: opts.now } }, { consumedAt: { not: null } }] },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "EmailChangeRequest", ids: ids(rows), reason: "expired or consumed email-change request" });
  }

  if (args.stale.betaInvitations) {
    const rows = await db.betaInvitation.findMany({
      where: { revokedAt: null, acceptedAt: null, expiresAt: { lt: cutoffDate } },
      select: { id: true },
    });
    ops.push({ kind: "revoke", model: "BetaInvitation", field: "revokedAt", ids: ids(rows), reason: "stale unaccepted beta invitation (revoked, not deleted)" });
  }

  if (args.stale.invitations) {
    const rows = await db.invitation.findMany({
      where: { cancelledAt: null, acceptedAt: null, expiresAt: { lt: cutoffDate } },
      select: { id: true },
    });
    ops.push({ kind: "revoke", model: "Invitation", field: "cancelledAt", ids: ids(rows), reason: "stale unaccepted alliance invitation (cancelled, not deleted)" });
  }

  if (args.accessRequestIds.length > 0) {
    const rows = await db.accessRequest.findMany({
      where: { id: { in: args.accessRequestIds } },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "AccessRequest", ids: ids(rows), reason: "explicitly identified test access request" });
  }

  if (args.feedbackIds.length > 0) {
    const rows = await db.feedback.findMany({
      where: { id: { in: args.feedbackIds } },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "Feedback", ids: ids(rows), reason: "explicitly identified test feedback" });
  }

  return { ops: ops.filter((o) => o.ids.length > 0), cutoff: cutoffUsed };
}

async function emailsToUserIds(db: Db, emails: string[]): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u: { id: string; email: string }) => [u.email.toLowerCase(), u.id]));
}

interface BuiltPlan {
  plan: CleanupOp[];
  cutoff: string | null;
  keepUserIds: string[];
  unknownUserEmails: string[];
  /** Keep-listed emails that don't resolve to an account. Must fail closed. */
  unknownKeepUserEmails: string[];
}

async function buildPlan(
  db: Db,
  args: CleanupArgs,
  opts: { now: Date; frozenCutoff: string | null }
): Promise<BuiltPlan> {
  const tenantPlans = await Promise.all(
    args.allianceIds.map(async (id) => assembleTenantPlan(await resolveTenant(db, id)))
  );

  const targetUserIds = await emailsToUserIds(db, args.userEmails);
  const unknownUserEmails = args.userEmails.filter((e) => !targetUserIds.has(e));
  const userPlans = await Promise.all(
    Array.from(targetUserIds.values()).map(async (uid) => assembleUserPlan(await resolveUser(db, uid)))
  );

  const stale = await resolveStaleOps(db, args, opts);
  const keepMap = await emailsToUserIds(db, args.keepUserEmails);
  const unknownKeepUserEmails = args.keepUserEmails.filter((e) => !keepMap.has(e));

  const plan = mergePlans([...tenantPlans, ...userPlans, stale.ops]);
  return {
    plan,
    cutoff: stale.cutoff,
    keepUserIds: Array.from(keepMap.values()),
    unknownUserEmails,
    unknownKeepUserEmails,
  };
}

/** Fail closed on any unresolved keep-listed account or overlapping selection. */
function assertSafeSelection(args: CleanupArgs, fresh: BuiltPlan): void {
  if (fresh.unknownKeepUserEmails.length > 0) {
    throw new Error(
      `Refusing to continue: --keep-user-email does not match any account (fail closed, fix the typo or remove it): ${fresh.unknownKeepUserEmails.join(", ")}`
    );
  }
  const overlaps = validateSelectionOverlaps(args);
  if (overlaps.length > 0) {
    throw new Error(`Refusing to continue: ${overlaps.join("; ")}`);
  }
  const userViolations = keepListViolations(fresh.plan, fresh.keepUserIds);
  if (userViolations.length > 0) {
    throw new Error(`Refusing to continue: plan would delete keep-listed user(s): ${userViolations.join(", ")}`);
  }
  const allianceViolations = allianceKeepListViolations(fresh.plan, args.keepAllianceIds);
  if (allianceViolations.length > 0) {
    throw new Error(`Refusing to continue: plan would delete keep-listed alliance(s): ${allianceViolations.join(", ")}`);
  }
}

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

async function executeOp(tx: Db, op: CleanupOp, now: Date): Promise<number> {
  if (op.kind === "delete") {
    if (op.model === "MetricPeriodMetric") {
      const pairs = op.ids.map((key) => {
        const [periodId, metricId] = key.split("::");
        return { periodId, metricId };
      });
      const { count } = await tx.metricPeriodMetric.deleteMany({ where: { OR: pairs } });
      return count;
    }
    const { count } = await tx[DELEGATE[op.model]].deleteMany({ where: { id: { in: op.ids } } });
    return count;
  }
  const data = op.kind === "nullify" ? { [op.field!]: null } : { [op.field!]: now };
  const { count } = await tx[DELEGATE[op.model]].updateMany({ where: { id: { in: op.ids } }, data });
  return count;
}

async function execute(args: CleanupArgs, manifest: CleanupManifest, identity: string): Promise<Record<string, number>> {
  return prisma.$transaction(
    async (tx: Db) => {
      // Serialize concurrent cleanup runs; released automatically at the end
      // of this transaction. Combined with Serializable isolation, this also
      // protects against interleaving with ordinary application writes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;

      const now = new Date();
      // Re-resolve EVERYTHING live, through this transaction. `manifest.ops`
      // is never read here — only `manifest.cutoff` (frozen boundary),
      // `manifest.dbIdentity`, and `manifest.checksum` (comparison target).
      const fresh = await buildPlan(tx, args, { now, frozenCutoff: manifest.cutoff });
      assertSafeSelection(args, fresh);

      const freshPayload = toChecksumPayload({
        cutoff: fresh.cutoff,
        dbIdentity: identity,
        keep: { userEmails: args.keepUserEmails, allianceIds: args.keepAllianceIds },
        plan: fresh.plan,
      });
      const verdict = verifyManifest(manifest, { dbIdentity: identity, payload: freshPayload });
      if (!verdict.ok) {
        throw new Error(`Refusing to execute: ${verdict.reason}`);
      }

      const expectedCounts = summarizeOpCounts(fresh.plan);
      const deleteCounts: Record<string, number> = {};

      for (const op of fresh.plan) {
        const affected = await executeOp(tx, op, now);
        const expected = expectedCounts[planOpKey(op)];
        if (affected !== expected) {
          throw new Error(
            `Refusing to commit: ${planOpKey(op)} affected ${affected} row(s), expected ${expected} (rolling back)`
          );
        }
        if (op.kind === "delete") {
          deleteCounts[op.model] = (deleteCounts[op.model] ?? 0) + affected;
        }
      }

      return deleteCounts;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 }
  );
}

async function runVerify(manifestPath: string): Promise<void> {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifest = validateManifestShape(raw);
  const integrity = verifyManifestIntegrity(manifest);
  if (!integrity.ok) {
    throw new Error(`Manifest failed integrity check: ${integrity.reason}`);
  }

  console.log(`Verifying ${manifest.ops.length} recorded operation(s) from ${manifestPath}\n(generated ${manifest.generatedAt})\n`);
  let failures = 0;

  for (const op of manifest.ops) {
    if (op.ids.length === 0) continue;

    if (op.model === "MetricPeriodMetric") {
      const pairs = op.ids.map((key) => {
        const [periodId, metricId] = key.split("::");
        return { periodId, metricId };
      });
      const remaining = await prisma.metricPeriodMetric.count({ where: { OR: pairs } });
      if (remaining > 0) {
        failures++;
        console.error(`FAIL: ${remaining}/${op.ids.length} MetricPeriodMetric row(s) still exist (expected deleted)`);
      } else {
        console.log(`OK:   MetricPeriodMetric delete (${op.ids.length} keys) fully applied`);
      }
      continue;
    }

    const delegate = (prisma as Db)[DELEGATE[op.model]];
    if (op.kind === "delete") {
      const remaining = await delegate.count({ where: { id: { in: op.ids } } });
      if (remaining > 0) {
        failures++;
        console.error(`FAIL: ${remaining}/${op.ids.length} ${op.model} row(s) still exist (expected deleted)`);
      } else {
        console.log(`OK:   ${op.model} delete (${op.ids.length} rows) fully applied`);
      }
    } else if (op.kind === "nullify") {
      const notNulled = await delegate.count({ where: { id: { in: op.ids }, [op.field!]: { not: null } } });
      if (notNulled > 0) {
        failures++;
        console.error(`FAIL: ${notNulled}/${op.ids.length} ${op.model}.${op.field} row(s) were NOT nullified`);
      } else {
        console.log(`OK:   ${op.model}.${op.field} nullify (${op.ids.length} rows) fully applied`);
      }
    } else {
      const notRevoked = await delegate.count({ where: { id: { in: op.ids }, [op.field!]: null } });
      if (notRevoked > 0) {
        failures++;
        console.error(`FAIL: ${notRevoked}/${op.ids.length} ${op.model}.${op.field} row(s) were NOT revoked`);
      } else {
        console.log(`OK:   ${op.model}.${op.field} revoke (${op.ids.length} rows) fully applied`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\nVerification FAILED: ${failures} operation(s) did not fully apply.`);
    process.exitCode = 1;
  } else {
    console.log(`\nVerification PASSED: all recorded operations were fully applied.`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.verify) {
    await runVerify(args.manifestPath);
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

  if (fresh.unknownUserEmails.length > 0) {
    console.warn(`\nWARNING: no account found for --user-email: ${fresh.unknownUserEmails.join(", ")}`);
  }

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
