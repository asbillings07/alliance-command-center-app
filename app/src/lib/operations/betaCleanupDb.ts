/**
 * Beta data cleanup — database orchestration (issue #161).
 *
 * The DB-touching half of the cleanup tool: resolving tenant/user ids into
 * plans, building/validating the manifest-bound plan, running the guarded
 * transactional execution, and the independent post-hoc `--verify` audit.
 * Pure planning logic (no DB access) lives in `./betaCleanup`; the CLI
 * argument parsing and console output live in `scripts/cleanup-beta-data.ts`.
 *
 * This module is split out from the script specifically so its DB-touching
 * behavior — most importantly the transactional execute/rollback path — is
 * directly importable by a real-Postgres integration test, not just
 * exercisable by manually running the CLI.
 */

import { readFileSync } from "node:fs";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { connectionIdentity, productionIdentities } from "../productionDb";
import {
  assembleTenantPlan,
  assembleUserPlan,
  mergePlans,
  toChecksumPayload,
  verifyManifest,
  verifyManifestIntegrity,
  validateManifestShape,
  summarizeOpCounts,
  planOpKey,
  resolveCutoffDate,
  keepListViolations,
  allianceKeepListViolations,
  validateSelectionOverlaps,
  type CleanupArgs,
  type CleanupOp,
  type CleanupModel,
  type TenantResolved,
  type UserResolved,
  type CleanupManifest,
} from "./betaCleanup";

/** Deterministic key so concurrent runs serialize (transaction-scoped). */
const ADVISORY_LOCK_KEY = 8161161161161161;

export const DELEGATE: Record<CleanupModel, string> = {
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
export type Db = any;

function ids<T extends { id: string }>(rows: T[]): string[] {
  return rows.map((r) => r.id);
}

export function resolveTargetIdentity(): { identity: string; isProduction: boolean } {
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

export async function inventory(db: Db): Promise<Record<string, number>> {
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

/**
 * Reads are sequential, not `Promise.all`-parallel: during `--execute`, `db`
 * is an interactive transaction client bound to a single connection, and
 * issuing concurrent queries against it is unreliable across drivers. Dry
 * runs pay a small latency cost for the same, single code path.
 */
export async function resolveTenant(db: Db, allianceId: string): Promise<TenantResolved> {
  const members = await db.allianceMember.findMany({ where: { allianceId }, select: { id: true } });
  const entries = await db.memberMetricEntry.findMany({
    where: { allianceMember: { allianceId } },
    select: { id: true },
  });
  const notes = await db.leadershipNote.findMany({
    where: { allianceMember: { allianceId } },
    select: { id: true },
  });
  const invitations = await db.invitation.findMany({ where: { allianceId }, select: { id: true } });
  const periods = await db.metricPeriod.findMany({ where: { allianceId }, select: { id: true } });
  const metrics = await db.metric.findMany({ where: { allianceId }, select: { id: true } });
  const periodMetrics = await db.metricPeriodMetric.findMany({
    where: { period: { allianceId } },
    select: { periodId: true, metricId: true },
  });
  const memberships = await db.allianceMembership.findMany({ where: { allianceId }, select: { id: true } });
  const betaInvitations = await db.betaInvitation.findMany({ where: { allianceId }, select: { id: true } });
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

export async function resolveUser(db: Db, userId: string): Promise<UserResolved> {
  const resetTokens = await db.passwordResetToken.findMany({ where: { userId }, select: { id: true } });
  const emailChanges = await db.emailChangeRequest.findMany({ where: { userId }, select: { id: true } });
  const feedback = await db.feedback.findMany({ where: { userId }, select: { id: true } });
  const notes = await db.leadershipNote.findMany({ where: { authorId: userId }, select: { id: true } });
  const sent = await db.invitation.findMany({ where: { invitedById: userId }, select: { id: true } });
  const accepted = await db.invitation.findMany({ where: { acceptedByUserId: userId }, select: { id: true } });
  const betaAccepted = await db.betaInvitation.findMany({
    where: { acceptedByUserId: userId },
    select: { id: true },
  });
  const linkedMembers = await db.allianceMember.findMany({ where: { userId }, select: { id: true } });
  const memberships = await db.allianceMembership.findMany({ where: { userId }, select: { id: true } });
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
export async function resolveStaleOps(
  db: Db,
  args: CleanupArgs,
  opts: { now: Date; frozenCutoff: string | null }
): Promise<{
  ops: CleanupOp[];
  cutoff: string | null;
  /** Explicitly-targeted ids that don't correspond to any existing row — must fail closed, never silently dropped. */
  unknownAccessRequestIds: string[];
  unknownFeedbackIds: string[];
}> {
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

  let unknownAccessRequestIds: string[] = [];
  if (args.accessRequestIds.length > 0) {
    const rows = await db.accessRequest.findMany({
      where: { id: { in: args.accessRequestIds } },
      select: { id: true },
    });
    const found = new Set(ids(rows));
    unknownAccessRequestIds = args.accessRequestIds.filter((id) => !found.has(id));
    ops.push({ kind: "delete", model: "AccessRequest", ids: ids(rows), reason: "explicitly identified test access request" });
  }

  let unknownFeedbackIds: string[] = [];
  if (args.feedbackIds.length > 0) {
    const rows = await db.feedback.findMany({
      where: { id: { in: args.feedbackIds } },
      select: { id: true },
    });
    const found = new Set(ids(rows));
    unknownFeedbackIds = args.feedbackIds.filter((id) => !found.has(id));
    ops.push({ kind: "delete", model: "Feedback", ids: ids(rows), reason: "explicitly identified test feedback" });
  }

  return {
    ops: ops.filter((o) => o.ids.length > 0),
    cutoff: cutoffUsed,
    unknownAccessRequestIds,
    unknownFeedbackIds,
  };
}

export async function emailsToUserIds(db: Db, emails: string[]): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u: { id: string; email: string }) => [u.email.toLowerCase(), u.id]));
}

export interface BuiltPlan {
  plan: CleanupOp[];
  cutoff: string | null;
  keepUserIds: string[];
  /** Target alliance ids that don't resolve to an alliance. Must fail closed — a typo must never silently no-op. */
  unknownAllianceIds: string[];
  /** Target emails that don't resolve to an account. Must fail closed — a typo must never silently no-op. */
  unknownUserEmails: string[];
  /** Keep-listed emails that don't resolve to an account. Must fail closed. */
  unknownKeepUserEmails: string[];
  /** Keep-listed alliance ids that don't resolve to an alliance. Must fail closed. */
  unknownKeepAllianceIds: string[];
  /** Explicitly-targeted ids with no matching row. Must fail closed. */
  unknownAccessRequestIds: string[];
  unknownFeedbackIds: string[];
}

async function idsToExistingSet(db: Db, model: "alliance" | "user", targetIds: string[]): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const rows = await db[model].findMany({ where: { id: { in: targetIds } }, select: { id: true } });
  return new Set(ids(rows));
}

export async function buildPlan(
  db: Db,
  args: CleanupArgs,
  opts: { now: Date; frozenCutoff: string | null }
): Promise<BuiltPlan> {
  const existingAllianceIds = await idsToExistingSet(db, "alliance", args.allianceIds);
  const unknownAllianceIds = args.allianceIds.filter((id) => !existingAllianceIds.has(id));

  // Sequential, not parallel: see the note on resolveTenant/resolveUser. Skip
  // unresolved ids rather than resolving them into a plan anyway — a typo'd
  // alliance id must never produce a phantom "delete Alliance <id>" op (which
  // would always affect 0 rows at execute time); assertSafeSelection aborts
  // the whole run on unknownAllianceIds before this would matter regardless.
  const tenantPlans: CleanupOp[][] = [];
  for (const id of args.allianceIds) {
    if (!existingAllianceIds.has(id)) continue;
    tenantPlans.push(assembleTenantPlan(await resolveTenant(db, id)));
  }

  const targetUserIds = await emailsToUserIds(db, args.userEmails);
  const unknownUserEmails = args.userEmails.filter((e) => !targetUserIds.has(e));
  // Iterate in the deterministic CLI input order, not Map.values() order —
  // the latter reflects Postgres's findMany() result ordering for an `IN`
  // clause, which isn't guaranteed to be stable. A different user-plan
  // processing order can change WHICH user's sub-plan first introduces a
  // given op key, changing the merged plan's array order and therefore its
  // checksum, even though the underlying data (and set of ops) is identical.
  const userPlans: CleanupOp[][] = [];
  const seenUserIds = new Set<string>();
  for (const email of args.userEmails) {
    const uid = targetUserIds.get(email);
    if (!uid || seenUserIds.has(uid)) continue;
    seenUserIds.add(uid);
    userPlans.push(assembleUserPlan(await resolveUser(db, uid)));
  }

  const stale = await resolveStaleOps(db, args, opts);
  const keepMap = await emailsToUserIds(db, args.keepUserEmails);
  const unknownKeepUserEmails = args.keepUserEmails.filter((e) => !keepMap.has(e));

  const existingKeepAllianceIds = await idsToExistingSet(db, "alliance", args.keepAllianceIds);
  const unknownKeepAllianceIds = args.keepAllianceIds.filter((id) => !existingKeepAllianceIds.has(id));

  const plan = mergePlans([...tenantPlans, ...userPlans, stale.ops]);
  return {
    plan,
    cutoff: stale.cutoff,
    keepUserIds: Array.from(keepMap.values()),
    unknownAllianceIds,
    unknownUserEmails,
    unknownKeepUserEmails,
    unknownKeepAllianceIds,
    unknownAccessRequestIds: stale.unknownAccessRequestIds,
    unknownFeedbackIds: stale.unknownFeedbackIds,
  };
}

/**
 * Fail closed on any unresolved target/keep-listed id, or overlapping
 * selection. A typo in ANY of these must abort the run rather than silently
 * produce a smaller plan than the operator asked for — an "unknown id" is
 * indistinguishable from "already handled" unless the tool refuses to guess.
 */
export function assertSafeSelection(args: CleanupArgs, fresh: BuiltPlan): void {
  if (fresh.unknownKeepUserEmails.length > 0) {
    throw new Error(
      `Refusing to continue: --keep-user-email does not match any account (fail closed, fix the typo or remove it): ${fresh.unknownKeepUserEmails.join(", ")}`
    );
  }
  if (fresh.unknownKeepAllianceIds.length > 0) {
    throw new Error(
      `Refusing to continue: --keep-alliance-id does not match any alliance (fail closed, fix the typo or remove it): ${fresh.unknownKeepAllianceIds.join(", ")}`
    );
  }
  if (fresh.unknownAllianceIds.length > 0) {
    throw new Error(
      `Refusing to continue: --alliance-id does not match any alliance (fail closed — remove it if already deleted, or fix the typo): ${fresh.unknownAllianceIds.join(", ")}`
    );
  }
  if (fresh.unknownUserEmails.length > 0) {
    throw new Error(
      `Refusing to continue: --user-email does not match any account (fail closed — remove it if already deleted, or fix the typo): ${fresh.unknownUserEmails.join(", ")}`
    );
  }
  if (fresh.unknownAccessRequestIds.length > 0) {
    throw new Error(
      `Refusing to continue: --access-request-ids includes id(s) that don't exist (fail closed — remove them if already deleted, or fix the typo): ${fresh.unknownAccessRequestIds.join(", ")}`
    );
  }
  if (fresh.unknownFeedbackIds.length > 0) {
    throw new Error(
      `Refusing to continue: --feedback-ids includes id(s) that don't exist (fail closed — remove them if already deleted, or fix the typo): ${fresh.unknownFeedbackIds.join(", ")}`
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

export async function executeOp(tx: Db, op: CleanupOp, now: Date): Promise<number> {
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

export async function execute(
  args: CleanupArgs,
  manifest: CleanupManifest,
  identity: string
): Promise<Record<string, number>> {
  return prisma.$transaction(
    async (tx: Db) => {
      // Serializes concurrent cleanup runs specifically (a lock only blocks
      // another session that takes the SAME lock; it does nothing for
      // ordinary application writes). Released automatically at the end of
      // this transaction. Serializable isolation is the separate guard
      // against interleaving with application writes: it doesn't prevent
      // them from happening, but it detects read/write conflicts with this
      // transaction's snapshot and aborts (with a serialization-failure
      // error) rather than letting this transaction commit against
      // now-stale data.
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

export interface VerifyResult {
  ok: boolean;
  failures: number;
  lines: string[];
}

export async function runVerify(manifestPath: string): Promise<VerifyResult> {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifest = validateManifestShape(raw);
  const integrity = verifyManifestIntegrity(manifest);
  if (!integrity.ok) {
    throw new Error(`Manifest failed integrity check: ${integrity.reason}`);
  }

  // Without this, verifying against the WRONG database (e.g. local dev) would
  // find none of the manifest's ids and print a false PASS.
  const { identity } = resolveTargetIdentity();
  if (identity !== manifest.dbIdentity) {
    throw new Error(
      `Refusing to verify: manifest was generated for database "${manifest.dbIdentity}" but the current target is "${identity}".`
    );
  }

  const lines: string[] = [
    `Verifying ${manifest.ops.length} recorded operation(s) from ${manifestPath} (generated ${manifest.generatedAt})`,
  ];
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
        lines.push(`FAIL: ${remaining}/${op.ids.length} MetricPeriodMetric row(s) still exist (expected deleted)`);
      } else {
        lines.push(`OK:   MetricPeriodMetric delete (${op.ids.length} keys) fully applied`);
      }
      continue;
    }

    const delegate = (prisma as Db)[DELEGATE[op.model]];
    if (op.kind === "delete") {
      const remaining = await delegate.count({ where: { id: { in: op.ids } } });
      if (remaining > 0) {
        failures++;
        lines.push(`FAIL: ${remaining}/${op.ids.length} ${op.model} row(s) still exist (expected deleted)`);
      } else {
        lines.push(`OK:   ${op.model} delete (${op.ids.length} rows) fully applied`);
      }
    } else if (op.kind === "nullify") {
      // A nullify/revoke target must still EXIST — checking only "field is
      // null/set" is vacuously true for a row that was unexpectedly deleted
      // entirely (id NOT IN the surviving rows also can't match "field is
      // not null"), which would silently pass verification.
      const existing = await delegate.count({ where: { id: { in: op.ids } } });
      const missing = op.ids.length - existing;
      const notNulled = await delegate.count({ where: { id: { in: op.ids }, [op.field!]: { not: null } } });
      if (missing > 0) {
        failures++;
        lines.push(`FAIL: ${missing}/${op.ids.length} ${op.model} row(s) meant to be nullified are MISSING (unexpectedly deleted)`);
      }
      if (notNulled > 0) {
        failures++;
        lines.push(`FAIL: ${notNulled}/${op.ids.length} ${op.model}.${op.field} row(s) were NOT nullified`);
      }
      if (missing === 0 && notNulled === 0) {
        lines.push(`OK:   ${op.model}.${op.field} nullify (${op.ids.length} rows) fully applied`);
      }
    } else {
      const existing = await delegate.count({ where: { id: { in: op.ids } } });
      const missing = op.ids.length - existing;
      const notRevoked = await delegate.count({ where: { id: { in: op.ids }, [op.field!]: null } });
      if (missing > 0) {
        failures++;
        lines.push(`FAIL: ${missing}/${op.ids.length} ${op.model} row(s) meant to be revoked are MISSING (unexpectedly deleted)`);
      }
      if (notRevoked > 0) {
        failures++;
        lines.push(`FAIL: ${notRevoked}/${op.ids.length} ${op.model}.${op.field} row(s) were NOT revoked`);
      }
      if (missing === 0 && notRevoked === 0) {
        lines.push(`OK:   ${op.model}.${op.field} revoke (${op.ids.length} rows) fully applied`);
      }
    }
  }

  return { ok: failures === 0, failures, lines };
}
