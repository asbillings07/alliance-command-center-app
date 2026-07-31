import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as BetaCleanup from "./betaCleanup";
import type * as BetaCleanupDb from "./betaCleanupDb";

/**
 * Real-Postgres integration tests for the parts of the cleanup tool that a
 * pure unit test (see ./betaCleanup.test.ts) cannot prove:
 *   - `execute()` actually commits its plan inside one Serializable
 *     transaction, deleting exactly the rows the manifest describes;
 *   - `execute()` refuses AND APPLIES NOTHING when the database has changed
 *     since the reviewed dry run (manifest/live-plan checksum mismatch),
 *     even when part of the stale plan is still individually valid;
 *   - two concurrent `execute()` calls against the same manifest serialize
 *     (via the advisory lock) rather than double-deleting or corrupting state;
 *   - `runVerify()` reports a nullify target as FAILED when the row was
 *     unexpectedly deleted entirely, not just vacuously "passed" because a
 *     deleted row can't fail a "field is not null" check.
 *
 * Gated behind INTEGRATION_DB so the DB-less "Unit Tests" job (which runs
 * every app/src test) skips them; the CI "Integration Tests" job sets
 * INTEGRATION_DB and provisions Postgres + migrations. Run locally with:
 *   INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("betaCleanupDb [integration]", () => {
  const createdAccessRequestIds: string[] = [];
  const createdBetaInvitationIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdAllianceIds: string[] = [];
  const createdUserIds: string[] = [];
  const manifestPaths: string[] = [];

  // Imported lazily (only when this suite actually runs) so the DB-less unit
  // job never constructs a PrismaClient / requires DATABASE_URL just by
  // loading this file. When the suite is skipped, beforeAll doesn't run.
  let prisma: PrismaClient;
  let parseArgs: typeof BetaCleanup.parseArgs;
  let buildManifest: typeof BetaCleanup.buildManifest;
  let execute: typeof BetaCleanupDb.execute;
  let buildPlan: typeof BetaCleanupDb.buildPlan;
  let runVerify: typeof BetaCleanupDb.runVerify;
  let resolveTargetIdentity: typeof BetaCleanupDb.resolveTargetIdentity;
  let identity: string;

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as { prisma: PrismaClient });
    ({ parseArgs, buildManifest } = await import("./betaCleanup"));
    ({ execute, buildPlan, runVerify, resolveTargetIdentity } = await import(
      "./betaCleanupDb"
    ));
    // Use the REAL resolved identity for this test database (not a synthetic
    // value) so runVerify()'s own identity resolution — which reads the same
    // DATABASE_URL independently — agrees with what we put in the manifest.
    ({ identity } = resolveTargetIdentity());
  });

  async function makeAccessRequest() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const row = await prisma.accessRequest.create({
      data: { name: "Integration Test", email: `access-int-${suffix}@example.test` },
    });
    createdAccessRequestIds.push(row.id);
    return row;
  }

  /** An AccessRequest with real triage decision history (#177) — the shape a leader's note/decline leaves behind. */
  async function makeAccessRequestWithTriage() {
    const ar = await makeAccessRequest();
    const now = new Date();
    await prisma.accessRequestTriage.create({
      data: {
        accessRequestId: ar.id,
        status: "PENDING",
        stateRevision: 1,
        lastEventAt: now,
        lastEventActorEmail: "operator-int@example.test",
      },
    });
    await prisma.accessRequestTriageEvent.create({
      data: {
        accessRequestId: ar.id,
        eventType: "NOTE_ADDED",
        previousStatus: "PENDING",
        nextStatus: "PENDING",
        noteText: "integration test note",
        actorEmail: "operator-int@example.test",
        createdAt: now,
      },
    });
    return ar;
  }

  async function makeAcceptedBetaInvitation() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `betacleanup-int-${suffix}@example.test`,
        displayName: "Beta Cleanup Integration",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    const participant = await prisma.betaParticipant.create({
      data: { userId: user.id },
    });
    createdParticipantIds.push(participant.id);
    const invitation = await prisma.betaInvitation.create({
      data: {
        email: user.email,
        token: `token-${suffix}`,
        code: `code-${suffix}`,
        expiresAt: new Date(Date.now() + 3600_000),
        acceptedAt: new Date(),
        acceptedByUserId: user.id,
        participantId: participant.id,
      },
    });
    createdBetaInvitationIds.push(invitation.id);
    return { user, invitation };
  }

  async function makeFullTenantAndUser() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `tenant-user-${suffix}@example.test`,
        displayName: "Tenant User Integration",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);

    const alliance = await prisma.alliance.create({
      data: {
        name: `Alliance Integration ${suffix}`,
        server: `Server-${suffix}`,
      },
    });
    createdAllianceIds.push(alliance.id);

    await prisma.allianceMembership.create({
      data: {
        allianceId: alliance.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    const member = await prisma.allianceMember.create({
      data: {
        allianceId: alliance.id,
        playerName: `Member ${suffix}`,
        userId: user.id,
      },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: `Metric ${suffix}`,
        type: "NUMERIC",
      },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: `Period ${suffix}`,
      },
    });

    await prisma.metricPeriodMetric.create({
      data: {
        periodId: period.id,
        metricId: metric.id,
        weight: 1,
        required: true,
      },
    });

    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: 10,
      },
    });

    await prisma.leadershipNote.create({
      data: {
        allianceMemberId: member.id,
        authorId: user.id,
        noteType: "POSITIVE",
        visibility: "LEADERSHIP",
        content: "Integration note content",
      },
    });

    await prisma.invitation.create({
      data: {
        allianceId: alliance.id,
        invitedById: user.id,
        playerNameSnapshot: "Invited Player",
        email: `invited-${suffix}@example.test`,
        membershipRole: "VIEWER",
        token: `inv-token-${suffix}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: `reset-token-${suffix}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const feedback = await prisma.feedback.create({
      data: {
        userId: user.id,
        submitterEmail: user.email,
        submitterDisplayName: user.displayName,
        category: "BUG",
        message: "Integration test feedback",
        url: "https://example.test",
        triage: {
          create: {
            status: "NEW",
            needsResponse: true,
            stateRevision: 0,
          },
        },
      },
    });

    await prisma.feedbackTriageEvent.create({
      data: {
        feedbackId: feedback.id,
        actorUserId: user.id,
        actorEmail: user.email,
        actorDisplayName: user.displayName,
        noteText: "cleanup integration note",
      },
    });

    return { user, alliance, member, metric, period, feedback };
  }

  async function manifestForAccessRequests(ids: string[]) {
    const args = parseArgs(["--access-request-ids", ids.join(",")]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });
    const manifest = buildManifest({
      cutoff: fresh.cutoff,
      dbIdentity: identity,
      keep: { userEmails: [], allianceIds: [] },
      plan: fresh.plan,
    });
    return { args, manifest };
  }

  afterEach(async () => {
    if (createdAccessRequestIds.length > 0) {
      // AccessRequestTriage/AccessRequestTriageEvent are `onDelete: Restrict`
      // against AccessRequest (#177) — unlike test tables under a real
      // `Cascade` FK, leftover rows here (e.g. from an assertion that failed
      // before the test's own execute() ran) would make this delete itself
      // throw and mask the original failure.
      await prisma.accessRequestTriageEvent.deleteMany({ where: { accessRequestId: { in: createdAccessRequestIds } } });
      await prisma.accessRequestTriage.deleteMany({ where: { accessRequestId: { in: createdAccessRequestIds } } });
      await prisma.accessRequest.deleteMany({ where: { id: { in: createdAccessRequestIds } } });
      createdAccessRequestIds.length = 0;
    }
    if (createdBetaInvitationIds.length > 0) {
      await prisma.betaInvitation.deleteMany({ where: { id: { in: createdBetaInvitationIds } } });
      createdBetaInvitationIds.length = 0;
    }
    if (createdParticipantIds.length > 0) {
      await prisma.betaParticipant.deleteMany({ where: { id: { in: createdParticipantIds } } });
      createdParticipantIds.length = 0;
    }
    if (createdAllianceIds.length > 0) {
      const allianceIds = [...createdAllianceIds];
      createdAllianceIds.length = 0;
      await prisma.memberMetricEntry.deleteMany({ where: { allianceMember: { allianceId: { in: allianceIds } } } });
      await prisma.leadershipNote.deleteMany({ where: { allianceMember: { allianceId: { in: allianceIds } } } });
      await prisma.invitation.deleteMany({ where: { allianceId: { in: allianceIds } } });
      await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: allianceIds } } } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: allianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: allianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: allianceIds } } });
      await prisma.allianceMembership.deleteMany({ where: { allianceId: { in: allianceIds } } });
      await prisma.betaInvitation.deleteMany({ where: { allianceId: { in: allianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: allianceIds } } });
    }
    if (createdUserIds.length > 0) {
      const userIds = [...createdUserIds];
      createdUserIds.length = 0;
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.emailChangeRequest.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.feedback.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.leadershipNote.deleteMany({ where: { authorId: { in: userIds } } });
      await prisma.invitation.deleteMany({ where: { invitedById: { in: userIds } } });
      await prisma.allianceMembership.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    for (const p of manifestPaths.splice(0)) {
      try {
        unlinkSync(p);
      } catch {
        // already removed by the test itself; fine.
      }
    }
  });

  it("integration: buildPlan() flags a typo'd/nonexistent --alliance-id rather than silently building a phantom delete", async () => {
    const args = parseArgs(["--alliance-id", "does-not-exist-12345"]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });

    expect(fresh.unknownAllianceIds).toEqual(["does-not-exist-12345"]);
    // No phantom "delete Alliance <id>" op for an id that was never found —
    // it must never surface as an always-affects-0-rows entry in the plan.
    expect(fresh.plan.some((op) => op.model === "Alliance")).toBe(false);
  });

  it("integration: execute() commits exactly the reviewed rows inside one transaction", async () => {
    const a = await makeAccessRequest();
    const b = await makeAccessRequest();
    const { args, manifest } = await manifestForAccessRequests([a.id, b.id]);

    const { deleteCounts } = await execute(args, manifest, identity);
    expect(deleteCounts.AccessRequest).toBe(2);

    const remaining = await prisma.accessRequest.count({ where: { id: { in: [a.id, b.id] } } });
    expect(remaining).toBe(0);
  });

  it("integration: execute() deletes an AccessRequest's triage decision history as ordinary FK-ordered ops before the request itself (#177)", async () => {
    const ar = await makeAccessRequestWithTriage();
    const { args, manifest } = await manifestForAccessRequests([ar.id]);

    // AccessRequestTriage/AccessRequestTriageEvent are `onDelete: Restrict`
    // against AccessRequest — a silent Cascade would erase this decision
    // history without ever showing up in deleteCounts. Ops-based deletion
    // (not a side-channel count like FeedbackTriage's Cascade) means it must
    // appear here explicitly, and in the right order or Postgres itself
    // would reject the AccessRequest delete with a foreign-key violation.
    expect(manifest.ops.map((o) => o.model)).toEqual([
      "AccessRequestTriageEvent",
      "AccessRequestTriage",
      "AccessRequest",
    ]);

    const { deleteCounts } = await execute(args, manifest, identity);
    expect(deleteCounts.AccessRequestTriageEvent).toBe(1);
    expect(deleteCounts.AccessRequestTriage).toBe(1);
    expect(deleteCounts.AccessRequest).toBe(1);

    expect(await prisma.accessRequestTriageEvent.count({ where: { accessRequestId: ar.id } })).toBe(0);
    expect(await prisma.accessRequestTriage.count({ where: { accessRequestId: ar.id } })).toBe(0);
    expect(await prisma.accessRequest.count({ where: { id: ar.id } })).toBe(0);
  });

  it("integration: execute() cleans up an AccessRequest that was never triaged, without a projection-count mismatch (#177)", async () => {
    // No AccessRequestTriage row exists for this request at all (an operator
    // never opened/actioned it) — resolveStaleOps must only target
    // AccessRequestTriage ids that actually have a projection row, or
    // execute()'s strict affected===expected check would roll back the
    // whole transaction over an op that could only ever affect 0 rows.
    const ar = await makeAccessRequest();
    const { args, manifest } = await manifestForAccessRequests([ar.id]);

    expect(manifest.ops.some((o) => o.model === "AccessRequestTriage")).toBe(false);
    expect(manifest.ops.some((o) => o.model === "AccessRequestTriageEvent")).toBe(false);

    const { deleteCounts } = await execute(args, manifest, identity);
    expect(deleteCounts.AccessRequest).toBe(1);
    expect(deleteCounts.AccessRequestTriage).toBeUndefined();

    expect(await prisma.accessRequest.count({ where: { id: ar.id } })).toBe(0);
  });

  it("integration: runVerify() correctly targets AccessRequestTriage by its own primary key (accessRequestId, not id) (#177)", async () => {
    const ar = await makeAccessRequestWithTriage();
    const { args, manifest } = await manifestForAccessRequests([ar.id]);

    await execute(args, manifest, identity);

    const manifestPath = join(tmpdir(), `beta-cleanup-manifest-art-verify-${Date.now()}.json`);
    manifestPaths.push(manifestPath);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await runVerify(manifestPath);
    expect(result.ok).toBe(true);
    expect(result.lines.some((l) => l.includes("OK:   AccessRequestTriage delete"))).toBe(true);
    expect(result.lines.some((l) => l.includes("OK:   AccessRequestTriageEvent delete"))).toBe(true);
  });

  it("integration: execute() refuses and applies nothing when the database changed since the dry run", async () => {
    const a = await makeAccessRequest();
    const b = await makeAccessRequest();
    const { args, manifest } = await manifestForAccessRequests([a.id, b.id]);

    // Simulate the database changing between dry-run review and execute: one
    // of the two reviewed rows is gone before execute() runs. This hits the
    // fail-closed "unknown target id" guard before even reaching the
    // checksum comparison — a more specific refusal than a generic mismatch,
    // and still just as fatal to the run.
    await prisma.accessRequest.deleteMany({ where: { id: a.id } });

    await expect(execute(args, manifest, identity)).rejects.toThrow(
      /Refusing to continue: --access-request-ids includes id\(s\) that don't exist/
    );

    // The still-existing row must NOT have been deleted — the stale manifest
    // is rejected wholesale rather than partially applying the id that's
    // still individually valid. Nothing from a rejected re-resolved plan
    // ever reaches an actual DELETE/UPDATE statement.
    const stillThere = await prisma.accessRequest.count({ where: { id: b.id } });
    expect(stillThere).toBe(1);
  });

  it("integration: execute() refuses and applies nothing when the manifest itself is stale (checksum mismatch, all ids still resolvable)", async () => {
    const a = await makeAccessRequest();
    const b = await makeAccessRequest();
    const { args, manifest } = await manifestForAccessRequests([a.id, b.id]);

    // Simulate a genuinely stale manifest where every id still resolves (so
    // the "unknown id" guard above doesn't fire) but the live plan no longer
    // matches what was reviewed — e.g. a third row was added after the dry
    // run that would now also be swept up under the same selection. Model
    // this directly: hand-edit the manifest's own checksum so it can never
    // match the freshly re-resolved plan, forcing the checksum-mismatch path.
    const staleManifest = { ...manifest, checksum: "0".repeat(64) };

    await expect(execute(args, staleManifest, identity)).rejects.toThrow(/Refusing to execute/);

    const remaining = await prisma.accessRequest.count({ where: { id: { in: [a.id, b.id] } } });
    expect(remaining).toBe(2);
  });

  it("integration: execute() refuses and applies nothing when a new decision-history event is appended after the dry run (#177)", async () => {
    const ar = await makeAccessRequestWithTriage();
    const { args, manifest } = await manifestForAccessRequests([ar.id]);

    // Simulate an operator adding another note between dry-run review and
    // execute: the live AccessRequestTriageEvent op would now have 2 ids
    // instead of the reviewed 1. A stale manifest must never partially
    // delete an incomplete slice of someone's decision history — it has to
    // reject the whole run via the checksum mismatch, same as any other
    // live-plan drift.
    await prisma.accessRequestTriageEvent.create({
      data: {
        accessRequestId: ar.id,
        eventType: "NOTE_ADDED",
        previousStatus: "PENDING",
        nextStatus: "PENDING",
        noteText: "a second note added after the dry run was reviewed",
        actorEmail: "operator-int@example.test",
      },
    });

    await expect(execute(args, manifest, identity)).rejects.toThrow(/Refusing to execute/);

    expect(await prisma.accessRequestTriageEvent.count({ where: { accessRequestId: ar.id } })).toBe(2);
    expect(await prisma.accessRequestTriage.count({ where: { accessRequestId: ar.id } })).toBe(1);
    expect(await prisma.accessRequest.count({ where: { id: ar.id } })).toBe(1);
  });

  it("integration: concurrent execute() of the same manifest lets exactly one succeed", async () => {
    const a = await makeAccessRequest();
    const b = await makeAccessRequest();
    const { args, manifest } = await manifestForAccessRequests([a.id, b.id]);

    // Both racers target the identical reviewed manifest. The advisory lock
    // serializes them; whichever runs second re-resolves the plan (now
    // empty, since the first already deleted both rows) and its checksum no
    // longer matches the manifest's two ids, so it must reject rather than
    // silently no-op or double-delete.
    const results = await Promise.allSettled([
      execute(args, manifest, identity),
      execute(args, manifest, identity),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof execute>>>).value.deleteCounts.AccessRequest).toBe(2);

    const remaining = await prisma.accessRequest.count({ where: { id: { in: [a.id, b.id] } } });
    expect(remaining).toBe(0);
  });

  it("integration: runVerify() PASSES a nullify op that was fully applied", async () => {
    const { user, invitation } = await makeAcceptedBetaInvitation();
    const args = parseArgs(["--user-email", user.email]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });
    const manifest = buildManifest({
      cutoff: fresh.cutoff,
      dbIdentity: identity,
      keep: { userEmails: [], allianceIds: [] },
      plan: fresh.plan,
    });

    await execute(args, manifest, identity);

    const manifestPath = join(tmpdir(), `beta-cleanup-manifest-verify-pass-${Date.now()}.json`);
    manifestPaths.push(manifestPath);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await runVerify(manifestPath);
    expect(result.ok).toBe(true);

    const after = await prisma.betaInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(after.acceptedByUserId).toBeNull();
  });

  it("integration: runVerify() FAILS a nullify target that was unexpectedly deleted entirely", async () => {
    const { user, invitation } = await makeAcceptedBetaInvitation();
    const args = parseArgs(["--user-email", user.email]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });
    const manifest = buildManifest({
      cutoff: fresh.cutoff,
      dbIdentity: identity,
      keep: { userEmails: [], allianceIds: [] },
      plan: fresh.plan,
    });

    await execute(args, manifest, identity);

    // Simulate the nullified row being deleted entirely by some later,
    // unrelated operation. A verify that only checks "field is not null"
    // would find zero matching rows and vacuously report success — this is
    // exactly the gap the "missing" check closes.
    await prisma.betaInvitation.deleteMany({ where: { id: invitation.id } });
    createdBetaInvitationIds.length = 0; // already gone; afterEach shouldn't re-delete

    const manifestPath = join(tmpdir(), `beta-cleanup-manifest-verify-fail-${Date.now()}.json`);
    manifestPaths.push(manifestPath);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await runVerify(manifestPath);
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => l.includes("MISSING (unexpectedly deleted)"))).toBe(true);
  });

  it("integration: buildPlan reports FeedbackTriage cascade counts for user feedback", async () => {
    const { user, feedback } = await makeFullTenantAndUser();
    const args = parseArgs(["--user-email", user.email]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });

    expect(fresh.feedbackTriageCascade).toEqual({
      feedbackIds: [feedback.id],
      triageProjections: 1,
      triageEvents: 1,
    });
  });

  it("integration: execute() reports in-transaction FeedbackTriage cascade counts when rows change after dry-run estimate", async () => {
    const { user, feedback } = await makeFullTenantAndUser();
    const args = parseArgs(["--user-email", user.email]);
    const dryRunPlan = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });
    expect(dryRunPlan.feedbackTriageCascade).toEqual({
      feedbackIds: [feedback.id],
      triageProjections: 1,
      triageEvents: 1,
    });

    const manifest = buildManifest({
      cutoff: dryRunPlan.cutoff,
      dbIdentity: identity,
      keep: { userEmails: [], allianceIds: [] },
      plan: dryRunPlan.plan,
    });

    const { feedbackTriageCascade } = await execute(args, manifest, identity, {
      onPlanResolved: async (_fresh, tx) => {
        await tx.feedbackTriageEvent.create({
          data: {
            feedbackId: feedback.id,
            actorUserId: user.id,
            actorEmail: user.email,
            actorDisplayName: user.displayName,
            noteText: "concurrent triage event appended before delete",
          },
        });
      },
    });

    expect(feedbackTriageCascade).toEqual({
      feedbackIds: [feedback.id],
      triageProjections: 1,
      triageEvents: 2,
    });
    expect(feedbackTriageCascade!.triageEvents).toBeGreaterThan(
      dryRunPlan.feedbackTriageCascade!.triageEvents,
    );
  });

  it("integration: execute() cleans up a representative tenant and user across all dependent models in PostgreSQL", async () => {
    const { user, alliance } = await makeFullTenantAndUser();
    const args = parseArgs(["--alliance-id", alliance.id, "--user-email", user.email]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });
    const manifest = buildManifest({
      cutoff: fresh.cutoff,
      dbIdentity: identity,
      keep: { userEmails: [], allianceIds: [] },
      plan: fresh.plan,
    });

    const { deleteCounts } = await execute(args, manifest, identity);

    expect(deleteCounts.Alliance).toBe(1);
    expect(deleteCounts.User).toBe(1);
    expect(deleteCounts.AllianceMember).toBe(1);
    expect(deleteCounts.AllianceMembership).toBe(1);
    expect(deleteCounts.Metric).toBe(1);
    expect(deleteCounts.MetricPeriod).toBe(1);
    expect(deleteCounts.MemberMetricEntry).toBe(1);
    expect(deleteCounts.LeadershipNote).toBe(1);
    expect(deleteCounts.Invitation).toBe(1);
    expect(deleteCounts.PasswordResetToken).toBe(1);
    expect(deleteCounts.Feedback).toBe(1);

    // Verify database state directly in PostgreSQL: all tenant and user records are deleted
    expect(await prisma.alliance.findUnique({ where: { id: alliance.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.allianceMember.count({ where: { allianceId: alliance.id } })).toBe(0);
    expect(await prisma.allianceMembership.count({ where: { allianceId: alliance.id } })).toBe(0);
    expect(await prisma.metric.count({ where: { allianceId: alliance.id } })).toBe(0);
    expect(await prisma.metricPeriod.count({ where: { allianceId: alliance.id } })).toBe(0);
    expect(await prisma.leadershipNote.count({ where: { authorId: user.id } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.feedback.count({ where: { userId: user.id } })).toBe(0);
  });

  it("integration: execute() rolls back earlier successful mutations in PostgreSQL when a later operation fails", async () => {
    // Op 1 & 2 in plan: User cleanup (will run first in mergePlans)
    const { user } = await makeAcceptedBetaInvitation();

    // Op 3 in plan: AccessRequest cleanup (will run after User cleanup in mergePlans)
    const ar = await makeAccessRequest();

    const args = parseArgs(["--access-request-ids", ar.id, "--user-email", user.email]);
    const fresh = await buildPlan(prisma, args, { now: new Date(), frozenCutoff: null });
    const manifest = buildManifest({
      cutoff: fresh.cutoff,
      dbIdentity: identity,
      keep: { userEmails: [], allianceIds: [] },
      plan: fresh.plan,
    });

    let userOpExecuted = false;

    // Use the test seam (opts.onOpExecuted) so that AFTER the User mutation
    // completes successfully inside the transaction, we delete the AccessRequest target inside
    // tx. When the transaction proceeds to the AccessRequest op, affected row count is 0
    // instead of expected 1, forcing a count-mismatch refusal and rolling back the User mutation.
    await expect(
      execute(args, manifest, identity, {
        onOpExecuted: async (op, affected, tx) => {
          if (op.model === "User") {
            userOpExecuted = true;
            expect(affected).toBe(1);
            // Delete the subsequent op's target inside tx before that op runs, causing it to affect 0 rows
            await tx.accessRequest.delete({ where: { id: ar.id } });
          }
        },
      })
    ).rejects.toThrow(/Refusing to commit: delete:AccessRequest: affected 0 row\(s\), expected 1/);

    expect(userOpExecuted).toBe(true);

    // Verify in PostgreSQL that the earlier User deletion was fully rolled back!
    const userAfter = await prisma.user.findUnique({ where: { id: user.id } });
    expect(userAfter).not.toBeNull();
    expect(userAfter?.id).toBe(user.id);
  });
});
