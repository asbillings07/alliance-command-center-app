#!/usr/bin/env tsx
/**
 * Beta data cleanup (issue #161).
 *
 * Removes test/smoke data from a target database through a reviewed,
 * manifest-bound, transactional operation. DRY RUN IS THE DEFAULT: without
 * --execute this only reads, prints an inventory + the proposed plan, and
 * writes a manifest for review. --execute replays ONLY the manifest's recorded
 * ids, under a PostgreSQL advisory lock, and aborts if the database drifted
 * since the manifest was generated.
 *
 * Safety model:
 *   - Tenant deletion (--alliance-id) and user deletion (--user-email) are
 *     separate. Keep-listed users can lose data from a deleted tenant but their
 *     account is never deleted.
 *   - The target database identity is resolved with the SAME resolver the app
 *     uses (app/src/lib/productionDb), so the tool and the app can never
 *     disagree about which database is production.
 *   - Feedback and AccessRequest are cleaned only by EXPLICIT id, never by age.
 *     Invitations are revoked (audit-preserving), not deleted.
 *
 * Usage (dry run):
 *   npx tsx scripts/cleanup-beta-data.ts \
 *     --alliance-id <id> --user-email test@example.com \
 *     --keep-user-email you@you.com --keep-alliance-id <smoke-alliance> \
 *     --include-expired-reset-tokens --manifest ./beta-cleanup-manifest.json
 *
 * Execute the reviewed manifest:
 *   npx tsx scripts/cleanup-beta-data.ts --execute --confirm-production \
 *     --manifest ./beta-cleanup-manifest.json <same selection flags>
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
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
  summarizePlan,
  summarizeDeletes,
  keepListViolations,
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

// The Prisma client is intentionally accessed dynamically by delegate name.
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

async function inventory(): Promise<Record<string, number>> {
  const [users, alliances, members, memberships, invitations, betaInvitations, feedback, accessRequests, resetTokens, emailChanges] =
    await Promise.all([
      prisma.user.count(),
      prisma.alliance.count(),
      prisma.allianceMember.count(),
      prisma.allianceMembership.count(),
      prisma.invitation.count(),
      prisma.betaInvitation.count(),
      prisma.feedback.count(),
      prisma.accessRequest.count(),
      prisma.passwordResetToken.count(),
      prisma.emailChangeRequest.count(),
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
  };
}

async function resolveTenant(allianceId: string): Promise<TenantResolved> {
  const [members, entries, notes, invitations, periods, metrics, periodMetrics, memberships, betaInvitations] =
    await Promise.all([
      prisma.allianceMember.findMany({ where: { allianceId }, select: { id: true } }),
      prisma.memberMetricEntry.findMany({ where: { allianceMember: { allianceId } }, select: { id: true } }),
      prisma.leadershipNote.findMany({ where: { allianceMember: { allianceId } }, select: { id: true } }),
      prisma.invitation.findMany({ where: { allianceId }, select: { id: true } }),
      prisma.metricPeriod.findMany({ where: { allianceId }, select: { id: true } }),
      prisma.metric.findMany({ where: { allianceId }, select: { id: true } }),
      prisma.metricPeriodMetric.findMany({
        where: { period: { allianceId } },
        select: { periodId: true, metricId: true },
      }),
      prisma.allianceMembership.findMany({ where: { allianceId }, select: { id: true } }),
      prisma.betaInvitation.findMany({ where: { allianceId }, select: { id: true } }),
    ]);
  return {
    allianceId,
    allianceMemberIds: ids(members),
    memberMetricEntryIds: ids(entries),
    leadershipNoteIds: ids(notes),
    invitationIds: ids(invitations),
    metricPeriodIds: ids(periods),
    metricIds: ids(metrics),
    metricPeriodMetricKeys: periodMetrics.map((pm) => `${pm.periodId}::${pm.metricId}`),
    allianceMembershipIds: ids(memberships),
    betaInvitationIds: ids(betaInvitations),
  };
}

async function resolveUser(userId: string): Promise<UserResolved> {
  const [resetTokens, emailChanges, feedback, notes, sent, accepted, betaAccepted, linkedMembers, memberships] =
    await Promise.all([
      prisma.passwordResetToken.findMany({ where: { userId }, select: { id: true } }),
      prisma.emailChangeRequest.findMany({ where: { userId }, select: { id: true } }),
      prisma.feedback.findMany({ where: { userId }, select: { id: true } }),
      prisma.leadershipNote.findMany({ where: { authorId: userId }, select: { id: true } }),
      prisma.invitation.findMany({ where: { invitedById: userId }, select: { id: true } }),
      prisma.invitation.findMany({ where: { acceptedByUserId: userId }, select: { id: true } }),
      prisma.betaInvitation.findMany({ where: { acceptedByUserId: userId }, select: { id: true } }),
      prisma.allianceMember.findMany({ where: { userId }, select: { id: true } }),
      prisma.allianceMembership.findMany({ where: { userId }, select: { id: true } }),
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

async function resolveStaleOps(args: CleanupArgs): Promise<{ ops: CleanupOp[]; cutoff: string | null }> {
  const now = new Date();
  const cutoffDate =
    args.cutoffDays > 0 ? new Date(now.getTime() - args.cutoffDays * 86_400_000) : now;
  const cutoffUsed =
    args.stale.betaInvitations || args.stale.invitations ? cutoffDate.toISOString() : null;
  const ops: CleanupOp[] = [];

  if (args.stale.expiredResetTokens) {
    const rows = await prisma.passwordResetToken.findMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "PasswordResetToken", ids: ids(rows), reason: "expired or consumed reset token" });
  }

  if (args.stale.consumedEmailChanges) {
    const rows = await prisma.emailChangeRequest.findMany({
      where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "EmailChangeRequest", ids: ids(rows), reason: "expired or consumed email-change request" });
  }

  if (args.stale.betaInvitations) {
    const rows = await prisma.betaInvitation.findMany({
      where: { revokedAt: null, acceptedAt: null, expiresAt: { lt: cutoffDate } },
      select: { id: true },
    });
    ops.push({ kind: "revoke", model: "BetaInvitation", field: "revokedAt", ids: ids(rows), reason: "stale unaccepted beta invitation (revoked, not deleted)" });
  }

  if (args.stale.invitations) {
    const rows = await prisma.invitation.findMany({
      where: { cancelledAt: null, acceptedAt: null, expiresAt: { lt: cutoffDate } },
      select: { id: true },
    });
    ops.push({ kind: "revoke", model: "Invitation", field: "cancelledAt", ids: ids(rows), reason: "stale unaccepted alliance invitation (cancelled, not deleted)" });
  }

  if (args.accessRequestIds.length > 0) {
    const rows = await prisma.accessRequest.findMany({
      where: { id: { in: args.accessRequestIds } },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "AccessRequest", ids: ids(rows), reason: "explicitly identified test access request" });
  }

  if (args.feedbackIds.length > 0) {
    const rows = await prisma.feedback.findMany({
      where: { id: { in: args.feedbackIds } },
      select: { id: true },
    });
    ops.push({ kind: "delete", model: "Feedback", ids: ids(rows), reason: "explicitly identified test feedback" });
  }

  return { ops: ops.filter((o) => o.ids.length > 0), cutoff: cutoffUsed };
}

async function emailsToUserIds(emails: string[]): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
}

async function buildPlan(args: CleanupArgs): Promise<{
  plan: CleanupOp[];
  cutoff: string | null;
  keepUserIds: string[];
  unknownUserEmails: string[];
}> {
  const tenantPlans = await Promise.all(
    args.allianceIds.map(async (id) => assembleTenantPlan(await resolveTenant(id)))
  );

  const targetUserIds = await emailsToUserIds(args.userEmails);
  const unknownUserEmails = args.userEmails.filter((e) => !targetUserIds.has(e));
  const userPlans = await Promise.all(
    Array.from(targetUserIds.values()).map(async (uid) => assembleUserPlan(await resolveUser(uid)))
  );

  const stale = await resolveStaleOps(args);
  const keepMap = await emailsToUserIds(args.keepUserEmails);

  const plan = mergePlans([...tenantPlans, ...userPlans, stale.ops]);
  return {
    plan,
    cutoff: stale.cutoff,
    keepUserIds: Array.from(keepMap.values()),
    unknownUserEmails,
  };
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

async function execute(manifest: CleanupManifest, identity: string): Promise<void> {
  // Re-resolve the plan from the CURRENT database and bind it to the reviewed
  // manifest. Any drift (rows added/removed since the dry run, or a different
  // target database) aborts before we mutate anything.
  const args = parseArgs(process.argv.slice(2));
  const fresh = await buildPlan(args);
  const verdict = verifyManifest(manifest, {
    dbIdentity: identity,
    payload: toChecksumPayload({
      cutoff: fresh.cutoff,
      dbIdentity: identity,
      keep: { userEmails: args.keepUserEmails, allianceIds: args.keepAllianceIds },
      plan: fresh.plan,
    }),
  });
  if (!verdict.ok) {
    throw new Error(`Refusing to execute: ${verdict.reason}`);
  }

  // Manifest ops carry no `reason` and use `field: null`; normalize to CleanupOp.
  const ops: CleanupOp[] = manifest.ops.map((o) => ({
    kind: o.kind,
    model: o.model,
    field: o.field ?? undefined,
    ids: o.ids,
    reason: "",
  }));

  const violations = keepListViolations(ops, fresh.keepUserIds);
  if (violations.length > 0) {
    throw new Error(`Refusing to execute: plan would delete keep-listed user(s): ${violations.join(", ")}`);
  }

  const now = new Date();
  const actual: Record<string, number> = {};

  await prisma.$transaction(async (tx: Db) => {
    // Serialize concurrent runs; released automatically at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
    for (const op of ops) {
      const count = await executeOp(tx, op, now);
      if (op.kind === "delete") {
        actual[op.model] = (actual[op.model] ?? 0) + count;
      }
    }
  });

  // Confirm what we deleted matches the reviewed manifest exactly.
  const mismatches = Object.entries(manifest.deleteCounts).filter(
    ([model, expected]) => (actual[model] ?? 0) !== expected
  );
  if (mismatches.length > 0) {
    throw new Error(
      `Post-execution count mismatch (transaction already committed — investigate): ${JSON.stringify({ expected: manifest.deleteCounts, actual })}`
    );
  }

  console.log("\nExecution complete. Deleted rows by model:", JSON.stringify(actual));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { identity, isProduction } = resolveTargetIdentity();

  console.log(`Target database identity: ${identity}${isProduction ? " (PRODUCTION)" : ""}`);

  if (args.execute) {
    if (productionIdentities(process.env.PRODUCTION_DB_HOSTS).length === 0) {
      throw new Error(
        "Refusing to --execute: set PRODUCTION_DB_HOSTS so the tool can recognize the production database."
      );
    }
    if (isProduction && !args.confirmProduction) {
      throw new Error(
        "Refusing to --execute against PRODUCTION without --confirm-production."
      );
    }
    const manifest = JSON.parse(readFileSync(args.manifestPath, "utf8")) as CleanupManifest;
    console.log(`\nExecuting reviewed manifest: ${args.manifestPath} (generated ${manifest.generatedAt})`);
    await execute(manifest, identity);
    printInventory("Inventory (after):", await inventory());
    return;
  }

  // Dry run (default): read-only. Inventory + plan + manifest for review.
  printInventory("Inventory (before):", await inventory());

  const { plan, cutoff, keepUserIds, unknownUserEmails } = await buildPlan(args);

  if (unknownUserEmails.length > 0) {
    console.warn(`\nWARNING: no account found for --user-email: ${unknownUserEmails.join(", ")}`);
  }

  const violations = keepListViolations(plan, keepUserIds);
  if (violations.length > 0) {
    throw new Error(
      `Plan would delete keep-listed user(s): ${violations.join(", ")}. Remove them from selection or the keep list.`
    );
  }

  printPlan(plan);

  const manifest = buildManifest({
    cutoff,
    dbIdentity: identity,
    keep: { userEmails: args.keepUserEmails, allianceIds: args.keepAllianceIds },
    plan,
  });
  writeFileSync(args.manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDRY RUN. Wrote manifest to ${args.manifestPath} (checksum ${manifest.checksum.slice(0, 12)}...).`);
  console.log("Review it, then re-run with --execute --confirm-production and the SAME flags.");
}

main()
  .catch((error) => {
    console.error("\nError:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
