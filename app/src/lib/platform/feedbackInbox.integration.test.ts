import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import {
  listFeedbackForTriage,
  listFeedbackFilterOptions,
  listFeedbackTriageHistory,
  ALL_TRIAGE_STATUSES,
} from "./feedbackInbox";
import { recordFeedbackTriageEvent } from "../feedbackTriage";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("feedbackInbox [integration]", () => {
  const createdFeedbackIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdAllianceIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdEventActorIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: (typeof import("../betaInvitation"))["issueBetaInvitation"];

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ issueBetaInvitation } = await import("../betaInvitation"));
  });

  afterEach(async () => {
    if (createdFeedbackIds.length > 0) {
      await prisma.feedbackTriageEvent.deleteMany({
        where: { feedbackId: { in: createdFeedbackIds } },
      });
      await prisma.feedbackTriage.deleteMany({
        where: { feedbackId: { in: createdFeedbackIds } },
      });
      await prisma.feedback.deleteMany({
        where: { id: { in: createdFeedbackIds } },
      });
      createdFeedbackIds.length = 0;
    }
    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitation.deleteMany({
        where: { id: { in: createdInvitationIds } },
      });
      createdInvitationIds.length = 0;
    }
    if (createdParticipantIds.length > 0) {
      await prisma.betaParticipant.deleteMany({
        where: { id: { in: createdParticipantIds } },
      });
      createdParticipantIds.length = 0;
    }
    if (createdAllianceIds.length > 0) {
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
    }
    if (createdEventActorIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdEventActorIds } },
      });
      createdEventActorIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function createUser(
    email: string,
    displayName: string,
  ): Promise<{ id: string; email: string; displayName: string }> {
    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: "hash",
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function seedFeedback(args: {
    suffix: string;
    message: string;
    category?: "BUG" | "IDEA" | "CONFUSING";
    allianceId?: string | null;
    status?: FeedbackTriageStatus;
    needsResponse?: boolean;
    withTriage?: boolean;
    submitterEmail?: string | null;
    submitterDisplayName?: string | null;
    userId?: string | null;
    createdAt?: Date;
  }) {
    let resolvedUserId = args.userId;
    let resolvedSubmitterEmail = args.submitterEmail;
    let resolvedSubmitterDisplayName = args.submitterDisplayName;

    if (resolvedUserId === undefined) {
      const user = await createUser(
        `fb-${args.suffix}@example.test`,
        `Submitter ${args.suffix}`,
      );
      resolvedUserId = user.id;
      if (resolvedSubmitterEmail === undefined) {
        resolvedSubmitterEmail = user.email;
      }
      if (resolvedSubmitterDisplayName === undefined) {
        resolvedSubmitterDisplayName = user.displayName;
      }
    } else if (
      resolvedUserId !== null &&
      (resolvedSubmitterEmail === undefined ||
        resolvedSubmitterDisplayName === undefined)
    ) {
      const user = await prisma.user.findUnique({
        where: { id: resolvedUserId },
        select: { email: true, displayName: true },
      });
      if (resolvedSubmitterEmail === undefined) {
        resolvedSubmitterEmail = user?.email ?? null;
      }
      if (resolvedSubmitterDisplayName === undefined) {
        resolvedSubmitterDisplayName = user?.displayName ?? null;
      }
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId: resolvedUserId ?? null,
        submitterEmail: resolvedSubmitterEmail ?? null,
        submitterDisplayName: resolvedSubmitterDisplayName ?? null,
        category: args.category ?? "BUG",
        message: args.message,
        url: `/platform/overview?marker=${args.suffix}`,
        allianceId: args.allianceId ?? null,
        createdAt: args.createdAt,
        ...(args.withTriage === false
          ? {}
          : {
              triage: {
                create: {
                  status: args.status ?? "NEW",
                  needsResponse: args.needsResponse ?? true,
                  stateRevision: 0,
                },
              },
            }),
      },
    });
    createdFeedbackIds.push(feedback.id);
    return { feedback, userId: resolvedUserId };
  }

  async function trackBetaParticipant(
    email: string,
    campaign: string,
    userId: string,
  ) {
    const invitation = await issueBetaInvitation(email, { campaign });
    createdInvitationIds.push(invitation.invitation.id);
    createdParticipantIds.push(invitation.invitation.participantId);
    await prisma.betaParticipant.update({
      where: { id: invitation.invitation.participantId },
      data: { userId },
    });
    return invitation.invitation;
  }

  it("returns empty results from one query round-trip", async () => {
    const queryRawSpy = vi.spyOn(prisma, "$queryRaw");
    const result = await listFeedbackForTriage(
      { search: `no-match-${Date.now()}@example.test` },
      1,
      10,
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    queryRawSpy.mockRestore();
  });

  it("surfaces missing-projection rows with coalesced defaults", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { feedback } = await seedFeedback({
      suffix,
      message: `overlap ${suffix}`,
      withTriage: false,
    });

    const result = await listFeedbackForTriage({ search: suffix }, 1, 50);
    expect(result.total).toBe(1);
    const item = result.items.find((i) => i.feedbackId === feedback.id);
    expect(item).toMatchObject({
      status: "NEW",
      needsResponse: true,
      stateRevision: 0,
      lastEventAt: feedback.createdAt,
      hasBeenTriaged: false,
    });
  });

  it("resolves deleted submitter from snapshot and unknown submitter fallback", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const deleted = await seedFeedback({
      suffix: `deleted-${suffix}`,
      message: `deleted submitter ${suffix}`,
      userId: null,
      submitterEmail: `deleted-${suffix}@example.test`,
      submitterDisplayName: "Deleted Submitter",
    });

    const unknown = await seedFeedback({
      suffix: `unknown-${suffix}`,
      message: `unknown submitter ${suffix}`,
      userId: null,
      submitterEmail: null,
      submitterDisplayName: null,
    });

    const result = await listFeedbackForTriage({ search: suffix }, 1, 50);

    const deletedItem = result.items.find(
      (i) => i.feedbackId === deleted.feedback.id,
    );
    expect(deletedItem?.submitterEmail).toBe(`deleted-${suffix}@example.test`);
    expect(deletedItem?.submitterDisplayName).toBe("Deleted Submitter");
    expect(deletedItem?.participantId).toBeNull();

    const unknownItem = result.items.find(
      (i) => i.feedbackId === unknown.feedback.id,
    );
    expect(unknownItem?.submitterEmail).toBe("Unknown submitter");
  });

  it("gracefully handles deleted alliance and missing participant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Gone Alliance ${suffix}`, server: `S-${suffix}` },
    });
    createdAllianceIds.push(alliance.id);

    const { feedback } = await seedFeedback({
      suffix,
      message: `alliance gone ${suffix}`,
      allianceId: alliance.id,
    });
    await prisma.alliance.delete({ where: { id: alliance.id } });
    createdAllianceIds.length = 0;

    const nonBeta = await seedFeedback({
      suffix: `nonbeta-${suffix}`,
      message: `non beta ${suffix}`,
    });

    const result = await listFeedbackForTriage({ search: suffix }, 1, 50);

    const allianceItem = result.items.find((i) => i.feedbackId === feedback.id);
    expect(allianceItem?.allianceId).toBe(alliance.id);
    expect(allianceItem?.allianceName).toBeNull();

    const nonBetaItem = result.items.find(
      (i) => i.feedbackId === nonBeta.feedback.id,
    );
    expect(nonBetaItem?.participantId).toBeNull();
    expect(nonBetaItem?.wave).toBeNull();
  });

  it("filters by status, category, allianceId, participantId, wave, and needsResponse", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Filter Alliance ${suffix}`, server: `S-${suffix}` },
    });
    createdAllianceIds.push(alliance.id);

    const user = await createUser(
      `filter-${suffix}@example.test`,
      "Filter User",
    );
    const invitation = await trackBetaParticipant(
      `beta-filter-${suffix}@example.test`,
      `Wave-${suffix}`,
      user.id,
    );

    const { feedback } = await seedFeedback({
      suffix,
      message: `filter target ${suffix}`,
      category: "IDEA",
      allianceId: alliance.id,
      status: "TRIAGED",
      needsResponse: false,
      userId: user.id,
    });

    expect(
      (await listFeedbackForTriage({ status: "TRIAGED", search: suffix }, 1, 50))
        .items.some((i) => i.feedbackId === feedback.id),
    ).toBe(true);
    expect(
      (await listFeedbackForTriage({ status: "NEW", search: suffix }, 1, 50))
        .total,
    ).toBe(0);

    expect(
      (await listFeedbackForTriage({ category: "IDEA", search: suffix }, 1, 50))
        .total,
    ).toBe(1);
    expect(
      (await listFeedbackForTriage({ category: "BUG", search: suffix }, 1, 50))
        .total,
    ).toBe(0);

    expect(
      (
        await listFeedbackForTriage(
          { allianceId: alliance.id, search: suffix },
          1,
          50,
        )
      ).total,
    ).toBe(1);

    expect(
      (
        await listFeedbackForTriage(
          { participantId: invitation.participantId, search: suffix },
          1,
          50,
        )
      ).total,
    ).toBe(1);

    expect(
      (await listFeedbackForTriage({ wave: `Wave-${suffix}`, search: suffix }, 1, 50))
        .total,
    ).toBe(1);

    expect(
      (
        await listFeedbackForTriage(
          { needsResponse: false, search: suffix },
          1,
          50,
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await listFeedbackForTriage(
          { needsResponse: true, search: suffix },
          1,
          50,
        )
      ).total,
    ).toBe(0);
  });

  it("searches by message, snapshot email, display name, and historical invitation email", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await createUser(
      `current-${suffix}@example.test`,
      `Display ${suffix}`,
    );
    const oldEmail = `historical-${suffix}@example.test`;
    const invitation = await issueBetaInvitation(oldEmail, {
      campaign: `Wave-${suffix}`,
    });
    createdInvitationIds.push(invitation.invitation.id);
    createdParticipantIds.push(invitation.invitation.participantId);
    await prisma.betaParticipant.update({
      where: { id: invitation.invitation.participantId },
      data: { userId: user.id },
    });

    const newInvite = await prisma.betaInvitation.create({
      data: {
        participantId: invitation.invitation.participantId,
        email: user.email,
        token: `token-${suffix}`,
        code: `CODE-${suffix.slice(0, 6).toUpperCase()}`,
        expiresAt: new Date("2026-12-01T12:00:00Z"),
        issuedAt: new Date("2026-07-01T12:00:00Z"),
      },
    });
    createdInvitationIds.push(newInvite.id);

    await seedFeedback({
      suffix,
      message: `needle-message-${suffix}`,
      userId: user.id,
    });

    expect(
      (await listFeedbackForTriage({ search: `needle-message-${suffix}` }, 1, 50))
        .total,
    ).toBe(1);
    expect(
      (await listFeedbackForTriage({ search: user.email }, 1, 50)).total,
    ).toBe(1);
    expect(
      (await listFeedbackForTriage({ search: `Display ${suffix}` }, 1, 50)).total,
    ).toBe(1);
    expect(
      (await listFeedbackForTriage({ search: oldEmail }, 1, 50)).total,
    ).toBe(1);
  });

  it("status-filtered total differs from summary.totalMatchingOtherFacets for pagination", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await seedFeedback({
      suffix: `new-${suffix}`,
      message: `new item ${suffix}`,
      status: "NEW",
    });
    await seedFeedback({
      suffix: `triaged-${suffix}`,
      message: `triaged item ${suffix}`,
      status: "TRIAGED",
    });

    const filtered = await listFeedbackForTriage(
      { status: "NEW", search: suffix },
      1,
      50,
    );

    expect(filtered.total).toBe(1);
    expect(filtered.summary.totalMatchingOtherFacets).toBe(2);
    expect(filtered.total).not.toBe(filtered.summary.totalMatchingOtherFacets);

    const maxPage = Math.max(1, Math.ceil(filtered.total / filtered.pageSize));
    const lastPage = await listFeedbackForTriage(
      { status: "NEW", search: suffix },
      maxPage,
      filtered.pageSize,
    );
    expect(lastPage.items.length).toBeGreaterThan(0);
    expect(lastPage.items.every((i) => i.status === "NEW")).toBe(true);
  });

  it("facet counts honor every other active filter dimension", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await seedFeedback({
      suffix: `a-${suffix}`,
      message: `facet a ${suffix}`,
      category: "BUG",
      status: "NEW",
      needsResponse: true,
    });
    await seedFeedback({
      suffix: `b-${suffix}`,
      message: `facet b ${suffix}`,
      category: "BUG",
      status: "TRIAGED",
      needsResponse: true,
    });
    await seedFeedback({
      suffix: `c-${suffix}`,
      message: `facet c ${suffix}`,
      category: "IDEA",
      status: "NEW",
      needsResponse: false,
    });

    const result = await listFeedbackForTriage(
      { category: "BUG", search: suffix },
      1,
      50,
    );

    expect(result.summary.statusCounts.NEW).toBe(1);
    expect(result.summary.statusCounts.TRIAGED).toBe(1);
    expect(result.summary.statusCounts.PLANNED).toBe(0);
    expect(result.summary.needsResponseCount).toBe(2);
    expect(result.summary.totalMatchingOtherFacets).toBe(2);

    const withStatus = await listFeedbackForTriage(
      { category: "BUG", status: "NEW", search: suffix },
      1,
      50,
    );
    expect(withStatus.summary.statusCounts.NEW).toBe(1);
    expect(withStatus.summary.statusCounts.TRIAGED).toBe(1);
    expect(withStatus.summary.needsResponseCount).toBe(1);
    expect(withStatus.summary.totalMatchingOtherFacets).toBe(2);
  });

  it("sets hasBeenTriaged when at least one triage event exists", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const operator = await createUser(
      `operator-${suffix}@example.test`,
      "Operator",
    );
    createdEventActorIds.push(operator.id);

    const { feedback } = await seedFeedback({
      suffix,
      message: `triaged flag ${suffix}`,
    });

    await recordFeedbackTriageEvent(
      feedback.id,
      operator.id,
      { note: "reviewed" },
      0,
    );

    const result = await listFeedbackForTriage({ search: suffix }, 1, 50);
    const item = result.items.find((i) => i.feedbackId === feedback.id);
    expect(item?.hasBeenTriaged).toBe(true);
  });

  it("listFeedbackFilterOptions returns bounded alliance and wave lists", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Options Alliance ${suffix}`, server: `S-${suffix}` },
    });
    createdAllianceIds.push(alliance.id);
    const user = await createUser(
      `options-${suffix}@example.test`,
      "Options User",
    );
    await trackBetaParticipant(
      `beta-options-${suffix}@example.test`,
      `OptionsWave-${suffix}`,
      user.id,
    );
    await seedFeedback({
      suffix,
      message: `options ${suffix}`,
      allianceId: alliance.id,
      userId: user.id,
    });

    const options = await listFeedbackFilterOptions();
    expect(
      options.alliances.some(
        (a) => a.id === alliance.id && a.name.includes("Options Alliance"),
      ),
    ).toBe(true);
    expect(
      options.waves.some((w) => w.id === `OptionsWave-${suffix}`),
    ).toBe(true);
  });

  it("listFeedbackTriageHistory reaches page 2 for many events", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const operator = await createUser(
      `history-${suffix}@example.test`,
      "History Operator",
    );
    createdEventActorIds.push(operator.id);

    const { feedback } = await seedFeedback({
      suffix,
      message: `history ${suffix}`,
    });

    let revision = 0;
    for (let i = 0; i < 12; i++) {
      const result = await recordFeedbackTriageEvent(
        feedback.id,
        operator.id,
        { note: `note ${i} ${suffix}` },
        revision,
      );
      if (result.ok) {
        revision = result.projection.stateRevision;
      }
    }

    const page1 = await listFeedbackTriageHistory(feedback.id, 1, 10);
    const page2 = await listFeedbackTriageHistory(feedback.id, 2, 10);

    expect(page1.total).toBe(12);
    expect(page1.items).toHaveLength(10);
    expect(page2.items).toHaveLength(2);
    expect(page2.page).toBe(2);

    const combined = [...page1.items, ...page2.items];
    expect(new Set(combined.map((e) => e.id)).size).toBe(12);

    for (let i = 1; i < combined.length; i++) {
      expect(combined[i - 1]!.createdAt.getTime()).toBeLessThanOrEqual(
        combined[i]!.createdAt.getTime(),
      );
    }
  });

  it("wave filter matches exact campaign value without prefix collision", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userOne = await createUser(
      `wave1-${suffix}@example.test`,
      "Wave One User",
    );
    const userTen = await createUser(
      `wave10-${suffix}@example.test`,
      "Wave Ten User",
    );

    await trackBetaParticipant(
      `beta-wave1-${suffix}@example.test`,
      "Wave-1",
      userOne.id,
    );
    await trackBetaParticipant(
      `beta-wave10-${suffix}@example.test`,
      "Wave-10",
      userTen.id,
    );

    const waveOne = await seedFeedback({
      suffix: `wave1-${suffix}`,
      message: `wave one feedback ${suffix}`,
      userId: userOne.id,
    });
    const waveTen = await seedFeedback({
      suffix: `wave10-${suffix}`,
      message: `wave ten feedback ${suffix}`,
      userId: userTen.id,
    });

    const result = await listFeedbackForTriage(
      { wave: "Wave-1", search: suffix },
      1,
      50,
    );

    expect(result.total).toBe(1);
    expect(result.items.map((i) => i.feedbackId)).toEqual([waveOne.feedback.id]);
    expect(result.summary.totalMatchingOtherFacets).toBe(1);
    expect(result.summary.statusCounts.NEW).toBe(1);
    expect(
      result.items.some((i) => i.feedbackId === waveTen.feedback.id),
    ).toBe(false);
  });

  it("covers every triage status in summary counts", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (const status of ALL_TRIAGE_STATUSES) {
      await seedFeedback({
        suffix: `${status}-${suffix}`,
        message: `${status} ${suffix}`,
        status,
      });
    }

    const result = await listFeedbackForTriage({ search: suffix }, 1, 50);
    for (const status of ALL_TRIAGE_STATUSES) {
      expect(result.summary.statusCounts[status]).toBe(1);
    }
    expect(result.summary.totalMatchingOtherFacets).toBe(ALL_TRIAGE_STATUSES.length);
  });
});
