import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as AccessRequestTriageModule from "./accessRequestTriage";
import {
  clearAccessRequestTriageTestHooks,
  setAccessRequestTriageAfterLockHook,
  setAccessRequestTriageBeforeLockHook,
} from "./accessRequestTriageTestHooks";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function enableBarrierHooks() {
  process.env.ACCESS_REQUEST_TRIAGE_TEST_HOOKS = "true";
}

describeIntegration("accessRequestTriage [integration]", () => {
  const createdAccessRequestIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdAllianceIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdParticipantIds: string[] = [];

  let prisma: PrismaClient;
  let addAccessRequestNote: typeof AccessRequestTriageModule.addAccessRequestNote;
  let declineAccessRequest: typeof AccessRequestTriageModule.declineAccessRequest;
  let resolveExistingAccess: typeof AccessRequestTriageModule.resolveExistingAccess;
  let reopenAccessRequest: typeof AccessRequestTriageModule.reopenAccessRequest;
  let convertAccessRequestToInvitation: typeof AccessRequestTriageModule.convertAccessRequestToInvitation;

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    ({ prisma } = (await import("./prisma")) as unknown as { prisma: PrismaClient });
    ({
      addAccessRequestNote,
      declineAccessRequest,
      resolveExistingAccess,
      reopenAccessRequest,
      convertAccessRequestToInvitation,
    } = await import("./accessRequestTriage"));
  });

  afterEach(async () => {
    clearAccessRequestTriageTestHooks();
    delete process.env.ACCESS_REQUEST_TRIAGE_TEST_HOOKS;

    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitationDeliveryAttempt.deleteMany({
        where: { invitationId: { in: createdInvitationIds } },
      });
    }
    if (createdAccessRequestIds.length > 0) {
      await prisma.accessRequestTriageEvent.deleteMany({
        where: { accessRequestId: { in: createdAccessRequestIds } },
      });
      await prisma.accessRequestTriage.deleteMany({
        where: { accessRequestId: { in: createdAccessRequestIds } },
      });
      await prisma.accessRequest.deleteMany({
        where: { id: { in: createdAccessRequestIds } },
      });
      createdAccessRequestIds.length = 0;
    }
    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitation.deleteMany({ where: { id: { in: createdInvitationIds } } });
      createdInvitationIds.length = 0;
    }
    if (createdParticipantIds.length > 0) {
      await prisma.betaParticipant.deleteMany({ where: { id: { in: createdParticipantIds } } });
      createdParticipantIds.length = 0;
    }
    if (createdAllianceIds.length > 0) {
      await prisma.allianceMembership.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  function suffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function makeOperator(label = "operator") {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix()}@example.test`,
        displayName: `${label} Operator`,
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeAccessRequest(email?: string) {
    const request = await prisma.accessRequest.create({
      data: {
        name: "Applicant",
        email: email ?? `applicant-${suffix()}@example.test`,
      },
    });
    createdAccessRequestIds.push(request.id);
    return request;
  }

  async function makeUserWithAllianceAccess(email: string) {
    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Existing Member",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);

    const alliance = await prisma.alliance.create({
      data: { name: `Alliance ${suffix()}`, server: "S1" },
    });
    createdAllianceIds.push(alliance.id);

    await prisma.allianceMembership.create({
      data: { userId: user.id, allianceId: alliance.id, role: "LEADER" },
    });

    return { user, alliance };
  }

  it("adds a note without changing status or requiring a revision", async () => {
    const operator = await makeOperator();
    const request = await makeAccessRequest();

    const result = await addAccessRequestNote(request.id, operator.id, "Looks legit, following up on Discord");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.status).toBe("PENDING");
    expect(result.projection.stateRevision).toBe(0);
    expect(result.projection.lastEventActorEmail).toBe(operator.email);

    const events = await prisma.accessRequestTriageEvent.findMany({
      where: { accessRequestId: request.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("NOTE_ADDED");
    // Non-transition event: previousStatus/nextStatus are NULL, not a
    // same-value pair (#177 review).
    expect(events[0]!.previousStatus).toBeNull();
    expect(events[0]!.nextStatus).toBeNull();
  });

  it("adding a note on a DECLINED request never overwrites the decision's currentReason or stateRevision", async () => {
    const operator = await makeOperator();
    const request = await makeAccessRequest();

    const declined = await declineAccessRequest(request.id, operator.id, "Not a good fit", 0);
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.projection.currentReason).toBe("Not a good fit");

    // A note with a different, equally valid non-null string must not
    // clobber the actual decision reason — the DB CHECK constraint alone
    // can't catch this, since both strings are valid non-null currentReason
    // values (#177 review follow-up).
    const noted = await addAccessRequestNote(request.id, operator.id, "Followed up on Discord, no reply yet");
    expect(noted.ok).toBe(true);
    if (!noted.ok) return;
    expect(noted.projection.status).toBe("DECLINED");
    expect(noted.projection.currentReason).toBe("Not a good fit");
    expect(noted.projection.stateRevision).toBe(declined.projection.stateRevision);
    expect(noted.projection.lastEventActorEmail).toBe(operator.email);
  });

  it("adding a note on a RESOLVED_EXISTING_ACCESS request never overwrites the resolution's currentReason, evidence, or stateRevision", async () => {
    const operator = await makeOperator();
    const email = `note-on-resolved-${suffix()}@example.test`;
    const { user, alliance } = await makeUserWithAllianceAccess(email);
    const request = await makeAccessRequest(email);

    const resolved = await resolveExistingAccess(request.id, operator.id, "Already has access", 0);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.projection.currentReason).toBe("Already has access");

    const noted = await addAccessRequestNote(request.id, operator.id, "Confirmed via alliance roster too");
    expect(noted.ok).toBe(true);
    if (!noted.ok) return;
    expect(noted.projection.status).toBe("RESOLVED_EXISTING_ACCESS");
    expect(noted.projection.currentReason).toBe("Already has access");
    expect(noted.projection.stateRevision).toBe(resolved.projection.stateRevision);
    expect(noted.projection.conflictUserIdSnapshot).toBe(user.id);
    expect(noted.projection.conflictAllianceIdSnapshot).toBe(alliance.id);
  });

  it("declines a pending request and rejects a stale second decline", async () => {
    const opA = await makeOperator("op-a");
    const opB = await makeOperator("op-b");
    const request = await makeAccessRequest();

    const first = await declineAccessRequest(request.id, opA.id, "Not a good fit", 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.projection.status).toBe("DECLINED");
    expect(first.projection.stateRevision).toBe(1);

    const second = await declineAccessRequest(request.id, opB.id, "Duplicate decision", 0);
    expect(second).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("resolves as existing access only when the identity truly has alliance access, and rejects otherwise", async () => {
    const operator = await makeOperator();
    const requestNoAccess = await makeAccessRequest();

    const rejected = await resolveExistingAccess(requestNoAccess.id, operator.id, "Thought they had access", 0);
    expect(rejected).toMatchObject({ ok: false, code: "VALIDATION" });

    const email = `has-access-${suffix()}@example.test`;
    const { user, alliance } = await makeUserWithAllianceAccess(email);
    const requestWithAccess = await makeAccessRequest(email);

    const resolved = await resolveExistingAccess(
      requestWithAccess.id,
      operator.id,
      "Already in Alliance",
      0,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.projection.status).toBe("RESOLVED_EXISTING_ACCESS");
    expect(resolved.projection.conflictUserIdSnapshot).toBe(user.id);
    expect(resolved.projection.conflictAllianceIdSnapshot).toBe(alliance.id);
    expect(resolved.projection.conflictMembershipCount).toBe(1);

    const events = await prisma.accessRequestTriageEvent.findMany({
      where: { accessRequestId: requestWithAccess.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("RESOLVED_EXISTING_ACCESS");
    expect(events[0]!.conflictAllianceName).toBe(alliance.name);
  });

  it("reopens a declined request unconditionally", async () => {
    const operator = await makeOperator();
    const request = await makeAccessRequest();

    const declined = await declineAccessRequest(request.id, operator.id, "Not now", 0);
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;

    const reopened = await reopenAccessRequest(
      request.id,
      operator.id,
      "Reconsidering after new info",
      declined.projection.stateRevision,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.projection.status).toBe("PENDING");
    expect(reopened.projection.stateRevision).toBe(2);
  });

  it("denies reopening a resolved request while access still exists, but refreshes evidence and bumps revision", async () => {
    const operator = await makeOperator();
    const email = `still-access-${suffix()}@example.test`;
    const { alliance } = await makeUserWithAllianceAccess(email);
    const request = await makeAccessRequest(email);

    const resolved = await resolveExistingAccess(request.id, operator.id, "Already has access", 0);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const denied = await reopenAccessRequest(
      request.id,
      operator.id,
      "Double-checking",
      resolved.projection.stateRevision,
    );
    expect(denied).toMatchObject({ ok: false, code: "REOPEN_DENIED_ACCESS_STILL_EXISTS" });
    if (denied.ok || denied.code !== "REOPEN_DENIED_ACCESS_STILL_EXISTS") return;
    expect(denied.projection.status).toBe("RESOLVED_EXISTING_ACCESS");
    expect(denied.projection.stateRevision).toBe(resolved.projection.stateRevision + 1);
    expect(denied.projection.conflictAllianceIdSnapshot).toBe(alliance.id);

    const events = await prisma.accessRequestTriageEvent.findMany({
      where: { accessRequestId: request.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[1]!.eventType).toBe("NOTE_ADDED");
    // Non-transition event (#177 review).
    expect(events[1]!.previousStatus).toBeNull();
    expect(events[1]!.nextStatus).toBeNull();
  });

  it("allows reopening a resolved request once access is genuinely gone", async () => {
    const operator = await makeOperator();
    const email = `access-removed-${suffix()}@example.test`;
    const { user, alliance } = await makeUserWithAllianceAccess(email);
    const request = await makeAccessRequest(email);

    const resolved = await resolveExistingAccess(request.id, operator.id, "Already has access", 0);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    // Access is removed after resolution.
    await prisma.allianceMembership.deleteMany({ where: { userId: user.id, allianceId: alliance.id } });

    const reopened = await reopenAccessRequest(
      request.id,
      operator.id,
      "Alliance access was revoked",
      resolved.projection.stateRevision,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.projection.status).toBe("PENDING");
    expect(reopened.projection.conflictUserIdSnapshot).toBeNull();
  });

  it("converts a pending request into a beta invitation and is idempotent on retry", async () => {
    const operator = await makeOperator();
    const email = `convertme-${suffix()}@example.test`;
    const request = await makeAccessRequest(email);

    const first = await convertAccessRequestToInvitation(request.id, operator.id, "Wave 1", 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdInvitationIds.push(first.invitation.id);
    createdParticipantIds.push(first.invitation.participantId);
    expect(first.createdNow).toBe(true);
    expect(first.shouldDeliver).toBe(true);
    expect(first.projection.status).toBe("INVITED");
    expect(first.projection.linkedInvitationId).toBe(first.invitation.id);
    expect(first.invitation.campaign).toBe("Wave 1");

    // A retry (e.g. a network double-send) replays the SAME stale revision
    // it originally saw — the idempotent already-INVITED return must still
    // succeed regardless, since it never reaches the revision check.
    const second = await convertAccessRequestToInvitation(request.id, operator.id, "Wave 1", 0);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.createdNow).toBe(false);
    expect(second.shouldDeliver).toBe(false);
    expect(second.invitation.id).toBe(first.invitation.id);

    const invitationCount = await prisma.betaInvitation.count({ where: { email } });
    expect(invitationCount).toBe(1);

    const events = await prisma.accessRequestTriageEvent.findMany({
      where: { accessRequestId: request.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("INVITED");
  });

  it("rejects a stale conversion when the request was declined and reopened after the operator loaded it", async () => {
    const opA = await makeOperator("op-a");
    const opB = await makeOperator("op-b");
    const request = await makeAccessRequest();

    // Operator A loads the request while it's PENDING at revision 0 and
    // starts reviewing it (e.g. leaves the tab open).
    const staleRevisionSeenByA = 0;

    // Meanwhile operator B declines it, then reopens it — status returns to
    // PENDING, but the revision has moved past what A is still holding.
    // Status alone can't catch this: A's Approve would otherwise see
    // "PENDING" and proceed as if nothing happened.
    const declined = await declineAccessRequest(request.id, opB.id, "Not now", 0);
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    const reopened = await reopenAccessRequest(
      request.id,
      opB.id,
      "Actually, reconsider this one",
      declined.projection.stateRevision,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.projection.status).toBe("PENDING");
    expect(reopened.projection.stateRevision).toBe(2);

    // A's stale Approve — still holding the original revision — must be
    // rejected as a STALE_CONFLICT rather than silently converting a
    // request whose PENDING state A never actually reviewed.
    const staleConvert = await convertAccessRequestToInvitation(
      request.id,
      opA.id,
      "Wave 1",
      staleRevisionSeenByA,
    );
    expect(staleConvert).toMatchObject({ ok: false, code: "STALE_CONFLICT" });
    if (staleConvert.ok || staleConvert.code !== "STALE_CONFLICT") return;
    expect(staleConvert.conflict.status).toBe("PENDING");
    expect(staleConvert.conflict.stateRevision).toBe(2);

    const invitationCount = await prisma.betaInvitation.count({ where: { email: request.email } });
    expect(invitationCount).toBe(0);
  });

  it("blocks conversion and records CONVERSION_BLOCKED when the identity already has alliance access", async () => {
    const operator = await makeOperator();
    const email = `blocked-${suffix()}@example.test`;
    await makeUserWithAllianceAccess(email);
    const request = await makeAccessRequest(email);

    const result = await convertAccessRequestToInvitation(request.id, operator.id, "Wave 1", 0);
    expect(result).toMatchObject({ ok: false, code: "CONVERSION_BLOCKED", conflictType: "EXISTING_ALLIANCE_ACCESS" });
    if (result.ok || result.code !== "CONVERSION_BLOCKED") return;
    expect(result.projection.status).toBe("PENDING");

    const events = await prisma.accessRequestTriageEvent.findMany({
      where: { accessRequestId: request.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("CONVERSION_BLOCKED");
    // Non-transition event (#177 review).
    expect(events[0]!.previousStatus).toBeNull();
    expect(events[0]!.nextStatus).toBeNull();
    expect(events[0]!.blockedConflictType).toBe("EXISTING_ALLIANCE_ACCESS");

    const invitationCount = await prisma.betaInvitation.count({ where: { email } });
    expect(invitationCount).toBe(0);
  });

  it("rejects an invalid beta wave label before touching the database", async () => {
    const operator = await makeOperator();
    const request = await makeAccessRequest();

    const tooLong = await convertAccessRequestToInvitation(request.id, operator.id, "x".repeat(81), 0);
    expect(tooLong).toMatchObject({ ok: false, code: "VALIDATION" });

    const blank = await convertAccessRequestToInvitation(request.id, operator.id, "   ", 0);
    expect(blank).toMatchObject({ ok: false, code: "VALIDATION" });

    const projection = await prisma.accessRequestTriage.findUnique({ where: { accessRequestId: request.id } });
    expect(projection).toBeNull();
  });

  it("serializes a note and a decline attempt on the same request via the projection lock (barrier ordering)", async () => {
    enableBarrierHooks();
    const opA = await makeOperator("op-a");
    const opB = await makeOperator("op-b");
    const request = await makeAccessRequest();

    const stateLocked = createDeferred<void>();
    const releaseState = createDeferred<void>();
    const noteAttemptingLock = createDeferred<void>();

    setAccessRequestTriageAfterLockHook(async (ctx) => {
      if (ctx.operation === "stateChange") {
        stateLocked.resolve(undefined);
        await releaseState.promise;
      }
    });
    setAccessRequestTriageBeforeLockHook(async (ctx) => {
      if (ctx.operation === "note") {
        noteAttemptingLock.resolve(undefined);
      }
    });

    const declinePromise = declineAccessRequest(request.id, opA.id, "Blocked pending lock", 0);
    await stateLocked.promise;

    const notePromise = addAccessRequestNote(request.id, opB.id, "queued note while locked");
    await noteAttemptingLock.promise;

    releaseState.resolve(undefined);
    const declineResult = await declinePromise;
    const noteResult = await notePromise;

    expect(declineResult.ok).toBe(true);
    expect(noteResult.ok).toBe(true);

    const events = await prisma.accessRequestTriageEvent.findMany({
      where: { accessRequestId: request.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.eventType)).toEqual(["DECLINED", "NOTE_ADDED"]);
  });

  it("lazy projection creation under concurrent first mutations yields exactly one row", async () => {
    const opA = await makeOperator("op-a");
    const opB = await makeOperator("op-b");
    const request = await makeAccessRequest();

    const results = await Promise.allSettled([
      addAccessRequestNote(request.id, opA.id, "first"),
      addAccessRequestNote(request.id, opB.id, "second"),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const projections = await prisma.accessRequestTriage.findMany({
      where: { accessRequestId: request.id },
    });
    expect(projections).toHaveLength(1);
    expect(
      await prisma.accessRequestTriageEvent.count({ where: { accessRequestId: request.id } }),
    ).toBe(2);
  });
});
