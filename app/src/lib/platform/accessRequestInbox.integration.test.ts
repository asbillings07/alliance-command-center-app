import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  listAccessRequestsForTriage,
  listAccessRequestTriageHistory,
  listBetaWaveOptions,
  checkAccessRequestConflict,
  getAccessRequestPendingCount,
  ALL_ACCESS_REQUEST_TRIAGE_STATUSES,
  ACCESS_REQUEST_INBOX_WAVE_OPTIONS_LIMIT,
} from "./accessRequestInbox";
import { BETA_PARTICIPANTS_INPUT_MAX_LENGTH } from "./betaParticipants";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("accessRequestInbox [integration]", () => {
  const createdAccessRequestIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdAllianceIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];

  let prisma: PrismaClient;
  let addAccessRequestNote: (typeof import("../accessRequestTriage"))["addAccessRequestNote"];
  let declineAccessRequest: (typeof import("../accessRequestTriage"))["declineAccessRequest"];
  let resolveExistingAccess: (typeof import("../accessRequestTriage"))["resolveExistingAccess"];

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as { prisma: PrismaClient });
    ({ addAccessRequestNote, declineAccessRequest, resolveExistingAccess } = await import(
      "../accessRequestTriage"
    ));
  });

  afterEach(async () => {
    if (createdAccessRequestIds.length > 0) {
      await prisma.accessRequestTriageEvent.deleteMany({
        where: { accessRequestId: { in: createdAccessRequestIds } },
      });
      await prisma.accessRequestTriage.deleteMany({
        where: { accessRequestId: { in: createdAccessRequestIds } },
      });
      await prisma.accessRequest.deleteMany({ where: { id: { in: createdAccessRequestIds } } });
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

  async function makeAccessRequest(overrides: { email?: string; name?: string; allianceName?: string } = {}) {
    const s = suffix();
    const request = await prisma.accessRequest.create({
      data: {
        name: overrides.name ?? `Applicant ${s}`,
        email: overrides.email ?? `applicant-${s}@example.test`,
        allianceName: overrides.allianceName,
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

  describe("listAccessRequestsForTriage", () => {
    it("returns empty results for a non-matching search", async () => {
      const result = await listAccessRequestsForTriage({ search: `no-match-${suffix()}` }, 1, 20);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("defaults status to PENDING for a request with no triage projection yet", async () => {
      const request = await makeAccessRequest();

      const result = await listAccessRequestsForTriage({ search: request.email }, 1, 20);
      expect(result.total).toBe(1);
      const item = result.items[0]!;
      expect(item.accessRequestId).toBe(request.id);
      expect(item.status).toBe("PENDING");
      expect(item.stateRevision).toBe(0);
      expect(item.linkedInvitationId).toBeNull();
      expect(item.betaWave).toBeNull();
      expect(item.currentReason).toBeNull();
    });

    it("searches by name and by email", async () => {
      const s = suffix();
      const request = await makeAccessRequest({ name: `Findme ${s}`, email: `findme-${s}@example.test` });

      expect((await listAccessRequestsForTriage({ search: `Findme ${s}` }, 1, 20)).total).toBe(1);
      expect((await listAccessRequestsForTriage({ search: `findme-${s}` }, 1, 20)).total).toBe(1);
      expect((await listAccessRequestsForTriage({ search: `nonexistent-${s}` }, 1, 20)).total).toBe(0);
      void request;
    });

    it("filters by status, reflecting decisions from the domain service", async () => {
      const operator = await makeOperator();
      const s = suffix();

      const pending = await makeAccessRequest({ email: `pending-${s}@example.test` });
      const declinedRequest = await makeAccessRequest({ email: `declined-${s}@example.test` });
      const declineResult = await declineAccessRequest(declinedRequest.id, operator.id, "Not a fit", 0);
      expect(declineResult.ok).toBe(true);

      const pendingList = await listAccessRequestsForTriage({ status: "PENDING", search: s }, 1, 20);
      expect(pendingList.items.map((i) => i.accessRequestId)).toContain(pending.id);
      expect(pendingList.items.map((i) => i.accessRequestId)).not.toContain(declinedRequest.id);

      const declinedList = await listAccessRequestsForTriage({ status: "DECLINED", search: s }, 1, 20);
      expect(declinedList.items.map((i) => i.accessRequestId)).toContain(declinedRequest.id);
      const declinedItem = declinedList.items.find((i) => i.accessRequestId === declinedRequest.id)!;
      expect(declinedItem.currentReason).toBe("Not a fit");
      expect(declinedItem.lastEventActorEmail).toBe(operator.email);
    });

    it("computes status counts across all statuses", async () => {
      const operator = await makeOperator();
      const s = suffix();

      await makeAccessRequest({ email: `count-pending-${s}@example.test` });
      const declined = await makeAccessRequest({ email: `count-declined-${s}@example.test` });
      await declineAccessRequest(declined.id, operator.id, "no", 0);

      const email = `count-resolved-${s}@example.test`;
      await makeUserWithAllianceAccess(email);
      const resolved = await makeAccessRequest({ email });
      await resolveExistingAccess(resolved.id, operator.id, "already has access", 0);

      const result = await listAccessRequestsForTriage({ search: s }, 1, 20);
      expect(result.statusCounts.PENDING).toBe(1);
      expect(result.statusCounts.DECLINED).toBe(1);
      expect(result.statusCounts.RESOLVED_EXISTING_ACCESS).toBe(1);
      expect(result.statusCounts.INVITED).toBe(0);
    });

    it("covers every triage status key even with zero matches", async () => {
      const result = await listAccessRequestsForTriage({ search: `zero-match-${suffix()}` }, 1, 20);
      for (const status of ALL_ACCESS_REQUEST_TRIAGE_STATUSES) {
        expect(result.statusCounts[status]).toBe(0);
      }
    });

    it("orders newest submission first and paginates", async () => {
      const s = suffix();
      const first = await makeAccessRequest({ email: `page1-${s}@example.test` });
      await new Promise((r) => setTimeout(r, 5));
      const second = await makeAccessRequest({ email: `page2-${s}@example.test` });

      const page1 = await listAccessRequestsForTriage({ search: s }, 1, 1);
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]!.accessRequestId).toBe(second.id);
      expect(page1.total).toBe(2);

      const page2 = await listAccessRequestsForTriage({ search: s }, 2, 1);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]!.accessRequestId).toBe(first.id);
    });

    it("bounds an oversized search filter safely", async () => {
      const request = await makeAccessRequest();
      const oversizedPrefix = "x".repeat(BETA_PARTICIPANTS_INPUT_MAX_LENGTH + 500);

      const result = await listAccessRequestsForTriage(
        { search: `${oversizedPrefix}${request.email}` },
        1,
        20,
      );
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });

    it("runs the paginated query in a single round trip (rows, total, and counts are separate queries by design)", async () => {
      const queryRawSpy = vi.spyOn(prisma, "$queryRaw");
      await listAccessRequestsForTriage({ search: `spy-${suffix()}` }, 1, 20);
      // Three deliberate queries: rows, total, status counts — documented as
      // simpler-but-more-round-trips than feedbackInbox's single-CTE shape.
      expect(queryRawSpy).toHaveBeenCalledTimes(3);
      queryRawSpy.mockRestore();
    });
  });

  describe("getAccessRequestPendingCount", () => {
    it("counts only PENDING requests, matching listAccessRequestsForTriage's PENDING statusCount", async () => {
      const operator = await makeOperator();
      const before = await getAccessRequestPendingCount();

      await makeAccessRequest();
      const declinedRequest = await makeAccessRequest();
      await declineAccessRequest(declinedRequest.id, operator.id, "no", 0);

      const after = await getAccessRequestPendingCount();
      // Exactly one new PENDING row (the second request moved to DECLINED).
      expect(after).toBe(before + 1);
    });

    it("runs a single lightweight query rather than the full three-query list read model (#177 review: avoid unnecessary DB load on every /platform/beta render)", async () => {
      const queryRawSpy = vi.spyOn(prisma, "$queryRaw");
      await getAccessRequestPendingCount();
      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      queryRawSpy.mockRestore();
    });
  });

  describe("listAccessRequestTriageHistory", () => {
    it("returns events newest-first, and page 1 with pageSize 5 is exactly the 5 newest", async () => {
      const operator = await makeOperator();
      const request = await makeAccessRequest();

      for (let i = 0; i < 7; i++) {
        const result = await addAccessRequestNote(request.id, operator.id, `note ${i}`);
        expect(result.ok).toBe(true);
      }

      const page1 = await listAccessRequestTriageHistory(request.id, 1, 5);
      expect(page1.total).toBe(7);
      expect(page1.items).toHaveLength(5);
      expect(page1.items.map((e) => e.noteText)).toEqual([
        "note 6",
        "note 5",
        "note 4",
        "note 3",
        "note 2",
      ]);
      for (let i = 1; i < page1.items.length; i++) {
        expect(page1.items[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
          page1.items[i]!.createdAt.getTime(),
        );
      }

      const page2 = await listAccessRequestTriageHistory(request.id, 2, 5);
      expect(page2.items).toHaveLength(2);
      expect(page2.items.map((e) => e.noteText)).toEqual(["note 1", "note 0"]);

      const combined = [...page1.items, ...page2.items];
      expect(new Set(combined.map((e) => e.id)).size).toBe(7);
    });

    it("returns an empty page for a request with no events yet", async () => {
      const request = await makeAccessRequest();
      const result = await listAccessRequestTriageHistory(request.id, 1, 5);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("maps event-type-specific fields for a RESOLVED_EXISTING_ACCESS event", async () => {
      const operator = await makeOperator();
      const email = `history-resolved-${suffix()}@example.test`;
      const { user, alliance } = await makeUserWithAllianceAccess(email);
      const request = await makeAccessRequest({ email });

      const resolved = await resolveExistingAccess(request.id, operator.id, "Already has access", 0);
      expect(resolved.ok).toBe(true);

      const history = await listAccessRequestTriageHistory(request.id, 1, 5);
      expect(history.items).toHaveLength(1);
      const event = history.items[0]!;
      expect(event.eventType).toBe("RESOLVED_EXISTING_ACCESS");
      expect(event.previousStatus).toBe("PENDING");
      expect(event.nextStatus).toBe("RESOLVED_EXISTING_ACCESS");
      expect(event.resolutionReason).toBe("Already has access");
      expect(event.conflictUserEmail).toBe(user.email);
      expect(event.conflictAllianceName).toBe(alliance.name);
      expect(event.conflictMembershipCount).toBe(1);
    });
  });

  describe("listBetaWaveOptions", () => {
    it("returns a bounded, distinct, alphabetically-ordered list of existing campaigns", async () => {
      const s = suffix();
      const participantA = await prisma.betaParticipant.create({ data: {} });
      const participantB = await prisma.betaParticipant.create({ data: {} });
      createdParticipantIds.push(participantA.id, participantB.id);

      const invA = await prisma.betaInvitation.create({
        data: {
          email: `wave-a-${s}@example.test`,
          token: `token-a-${s}`,
          code: `CA${s.slice(0, 6).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: participantA.id,
          campaign: `ZZZ-Wave-${s}`,
        },
      });
      const invB = await prisma.betaInvitation.create({
        data: {
          email: `wave-b-${s}@example.test`,
          token: `token-b-${s}`,
          code: `CB${s.slice(0, 6).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: participantB.id,
          campaign: `AAA-Wave-${s}`,
        },
      });
      createdInvitationIds.push(invA.id, invB.id);

      const options = await listBetaWaveOptions();
      const relevant = options.filter((o) => o.name.includes(s));
      expect(relevant.map((o) => o.name)).toEqual([`AAA-Wave-${s}`, `ZZZ-Wave-${s}`]);
      expect(options.length).toBeLessThanOrEqual(ACCESS_REQUEST_INBOX_WAVE_OPTIONS_LIMIT);
    });

    it("excludes null campaigns", async () => {
      const s = suffix();
      const participant = await prisma.betaParticipant.create({ data: {} });
      createdParticipantIds.push(participant.id);
      const invitation = await prisma.betaInvitation.create({
        data: {
          email: `no-wave-${s}@example.test`,
          token: `token-nowave-${s}`,
          code: `CN${s.slice(0, 6).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: participant.id,
        },
      });
      createdInvitationIds.push(invitation.id);

      const options = await listBetaWaveOptions();
      expect(options.some((o) => o.id === null)).toBe(false);
    });

    it("excludes legacy campaign values that violate convertAccessRequestToInvitation's own beta-wave bound (#177 review)", async () => {
      const s = suffix();

      // issueBetaInvitation (pre-#177) only ever does `.trim() || null` on
      // campaign — no length bound, no control-character check — so these
      // rows are directly seeded here to simulate what that looser path can
      // still produce today.
      const blank = await prisma.betaParticipant.create({ data: {} });
      const oversized = await prisma.betaParticipant.create({ data: {} });
      const withControlChar = await prisma.betaParticipant.create({ data: {} });
      const untrimmed = await prisma.betaParticipant.create({ data: {} });
      createdParticipantIds.push(blank.id, oversized.id, withControlChar.id, untrimmed.id);

      const blankInv = await prisma.betaInvitation.create({
        data: {
          email: `blank-wave-${s}@example.test`,
          token: `token-blank-${s}`,
          code: `CBL${s.slice(0, 5).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: blank.id,
          campaign: "   ",
        },
      });
      const oversizedInv = await prisma.betaInvitation.create({
        data: {
          email: `oversized-wave-${s}@example.test`,
          token: `token-oversized-${s}`,
          code: `COV${s.slice(0, 5).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: oversized.id,
          campaign: `Oversized-${s}-${"x".repeat(90)}`,
        },
      });
      const controlCharInv = await prisma.betaInvitation.create({
        data: {
          email: `control-wave-${s}@example.test`,
          token: `token-control-${s}`,
          code: `CCT${s.slice(0, 5).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: withControlChar.id,
          campaign: `Bad-${s}\nInjected`,
        },
      });
      const untrimmedInv = await prisma.betaInvitation.create({
        data: {
          email: `untrimmed-wave-${s}@example.test`,
          token: `token-untrimmed-${s}`,
          code: `CUT${s.slice(0, 5).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 3600_000),
          participantId: untrimmed.id,
          campaign: `  Untrimmed-${s}  `,
        },
      });
      createdInvitationIds.push(blankInv.id, oversizedInv.id, controlCharInv.id, untrimmedInv.id);

      const options = await listBetaWaveOptions();
      const relevant = options.filter((o) => o.name.includes(s));

      expect(relevant.map((o) => o.name)).toEqual([`Untrimmed-${s}`]);
      expect(options.some((o) => o.name.startsWith("Oversized-"))).toBe(false);
      expect(options.some((o) => o.name.includes("Injected"))).toBe(false);
      expect(options.some((o) => o.name === "")).toBe(false);
    });
  });

  describe("checkAccessRequestConflict", () => {
    it("returns NOT_FOUND for a missing access request", async () => {
      const result = await checkAccessRequestConflict("does-not-exist");
      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    });

    it("returns NONE for a request whose identity has no conflicts", async () => {
      const request = await makeAccessRequest();
      const result = await checkAccessRequestConflict(request.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resolution).toEqual({ primary: { type: "NONE" }, all: [] });
    });

    it("surfaces EXISTING_ALLIANCE_ACCESS using the same classifier as conversion", async () => {
      const email = `precheck-${suffix()}@example.test`;
      const { user, alliance } = await makeUserWithAllianceAccess(email);
      const request = await makeAccessRequest({ email });

      const result = await checkAccessRequestConflict(request.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resolution.primary).toMatchObject({
        type: "EXISTING_ALLIANCE_ACCESS",
        userId: user.id,
        allianceId: alliance.id,
        membershipCount: 1,
      });
    });
  });
});
