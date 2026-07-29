import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  listBetaParticipants,
  listBetaParticipantPriorAttempts,
  buildIlikeContainsPattern,
} from "./betaParticipants";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("betaParticipants unified query [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdAllianceIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: (typeof import("../betaInvitation"))["issueBetaInvitation"];
  let reissueBetaInvitation: (typeof import("../betaInvitation"))["reissueBetaInvitation"];
  let acceptBetaInvitation: (typeof import("../betaInvitation"))["acceptBetaInvitation"];

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ issueBetaInvitation, reissueBetaInvitation, acceptBetaInvitation } =
      await import("../betaInvitation"));
  });

  afterEach(async () => {
    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitation.deleteMany({
        where: { id: { in: createdInvitationIds } },
      });
      createdInvitationIds.length = 0;
    }
    if (createdAllianceIds.length > 0) {
      await prisma.allianceMembership.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
    }
    if (createdParticipantIds.length > 0) {
      await prisma.betaParticipant.deleteMany({
        where: { id: { in: createdParticipantIds } },
      });
      createdParticipantIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function trackInvitation(email: string, campaign?: string) {
    const result = await issueBetaInvitation(email, { campaign });
    createdInvitationIds.push(result.invitation.id);
    createdParticipantIds.push(result.invitation.participantId);
    return result.invitation;
  }

  async function trackReissue(participantId: string, issuedByUserId?: string) {
    let operatorId = issuedByUserId;
    if (!operatorId) {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const operator = await prisma.user.create({
        data: {
          email: `reissue-operator-${suffix}@example.test`,
          displayName: "Reissue Operator",
          passwordHash: "hash",
        },
      });
      createdUserIds.push(operator.id);
      operatorId = operator.id;
    }
    const result = await reissueBetaInvitation(participantId, operatorId);
    createdInvitationIds.push(result.invitation.id);
    return result.invitation;
  }

  it("returns empty results when no participants exist for a unique search", async () => {
    const queryRawSpy = vi.spyOn(prisma, "$queryRaw");
    const result = await listBetaParticipants(
      { search: `no-match-${Date.now()}@example.test` },
      1,
      10,
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.summary.totalParticipants).toBe(0);
    expect(result.summary.totalInvitationAttempts).toBe(0);
    expect(result.summary.acceptedParticipants).toBe(0);
    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    queryRawSpy.mockRestore();
  });

  it("returns rows, total, and summary from one query round-trip", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await trackInvitation(`beta-unified-${suffix}@example.test`);

    const queryRawSpy = vi.spyOn(prisma, "$queryRaw");
    const result = await listBetaParticipants({ search: suffix }, 1, 50);

    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    expect(result.summary.totalParticipants).toBe(result.total);
    expect(result.items.length).toBeLessThanOrEqual(result.total);
    queryRawSpy.mockRestore();
  });

  it("finds participants by any historical invitation email", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const oldEmail = `beta-old-${suffix}@example.test`;
    const newEmail = `beta-new-${suffix}@example.test`;

    const first = await trackInvitation(oldEmail);
    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date(), issuedAt: new Date("2026-06-01T12:00:00Z") },
    });

    const second = await prisma.betaInvitation.create({
      data: {
        participantId: first.participantId,
        email: newEmail,
        token: `token-new-${suffix}`,
        code: `CODE-${suffix.slice(0, 6).toUpperCase()}`,
        expiresAt: new Date("2026-12-01T12:00:00Z"),
        issuedAt: new Date("2026-07-01T12:00:00Z"),
      },
    });
    createdInvitationIds.push(second.id);

    const byOldEmail = await listBetaParticipants({ search: oldEmail }, 1, 50);
    expect(byOldEmail.total).toBe(1);
    expect(byOldEmail.items[0]?.participantId).toBe(first.participantId);
    expect(byOldEmail.items[0]?.latestAttempt.email).toBe(newEmail);

    const byNewEmail = await listBetaParticipants({ search: newEmail }, 1, 50);
    expect(byNewEmail.total).toBe(1);
    expect(byNewEmail.items[0]?.participantId).toBe(first.participantId);
  });

  it("filters by search, wave, journey stage, and attention reason in SQL", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `beta-query-${suffix}@example.test`;
    const now = new Date("2026-07-29T12:00:00Z");
    const staleIssuedAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    const invitation = await trackInvitation(email, "Wave Alpha");
    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { issuedAt: staleIssuedAt },
    });

    const bySearch = await listBetaParticipants({ search: suffix }, 1, 50, now);
    expect(bySearch.items.some((i) => i.latestAttempt.email === email)).toBe(
      true,
    );

    const byWave = await listBetaParticipants({ wave: "Wave Alpha" }, 1, 50, now);
    expect(byWave.items.some((i) => i.participantId === invitation.participantId)).toBe(
      true,
    );

    const byStage = await listBetaParticipants(
      { journeyStage: "invited" },
      1,
      50,
      now,
    );
    expect(
      byStage.items.some((i) => i.participantId === invitation.participantId),
    ).toBe(true);

    const byAttention = await listBetaParticipants(
      { attentionReason: "invitation_pending_stale" },
      1,
      50,
      now,
    );
    expect(
      byAttention.items.some((i) => i.participantId === invitation.participantId),
    ).toBe(true);
  });

  it("paginates with deterministic ordering and bounded pages", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emails = [
      `beta-page-a-${suffix}@example.test`,
      `beta-page-b-${suffix}@example.test`,
      `beta-page-c-${suffix}@example.test`,
    ];

    const invitations = [];
    for (const email of emails) {
      invitations.push(await trackInvitation(email));
    }

    const issuedTimes = [
      new Date("2026-07-01T12:00:00Z"),
      new Date("2026-07-15T12:00:00Z"),
      new Date("2026-07-29T12:00:00Z"),
    ];
    for (let i = 0; i < invitations.length; i++) {
      await prisma.betaInvitation.update({
        where: { id: invitations[i]!.id },
        data: {
          issuedAt: issuedTimes[i],
          createdAt: issuedTimes[i],
        },
      });
    }

    const page1 = await listBetaParticipants({ search: suffix }, 1, 2);
    const page2 = await listBetaParticipants({ search: suffix }, 2, 2);
    const pageBeyond = await listBetaParticipants({ search: suffix }, 99, 2);

    expect(page1.items).toHaveLength(2);
    expect(page1.items.map((i) => i.latestAttempt.id)).toEqual([
      invitations[2]!.id,
      invitations[1]!.id,
    ]);
    expect(page2.items.map((i) => i.latestAttempt.id)).toEqual([
      invitations[0]!.id,
    ]);
    expect(pageBeyond.items).toHaveLength(0);

    const ids = [...page1.items, ...page2.items].map((i) => i.participantId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns items in exact issuedAt/createdAt/id order when timestamps tie", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tiedTime = new Date("2026-07-15T12:00:00Z");

    const invA = await trackInvitation(`beta-order-a-${suffix}@example.test`);
    const invB = await trackInvitation(`beta-order-b-${suffix}@example.test`);
    const invC = await trackInvitation(`beta-order-c-${suffix}@example.test`);

    await prisma.betaInvitation.update({
      where: { id: invC.id },
      data: {
        issuedAt: new Date("2026-07-29T12:00:00Z"),
        createdAt: new Date("2026-07-29T12:00:00Z"),
      },
    });
    await prisma.betaInvitation.updateMany({
      where: { id: { in: [invA.id, invB.id] } },
      data: { issuedAt: tiedTime, createdAt: tiedTime },
    });

    const result = await listBetaParticipants({ search: suffix }, 1, 10);
    const attemptIds = result.items.map((item) => item.latestAttempt.id);

    expect(attemptIds).toHaveLength(3);
    expect(attemptIds[0]).toBe(invC.id);

    const tiedIds = [invA.id, invB.id].sort((a, b) => b.localeCompare(a));
    expect(attemptIds[1]).toBe(tiedIds[0]);
    expect(attemptIds[2]).toBe(tiedIds[1]);
  });

  it("escapes ILIKE wildcards in search", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const literalEmail = `beta-100%-done-${suffix}@example.test`;
    await trackInvitation(literalEmail);

    const pattern = buildIlikeContainsPattern("100%-done");
    expect(pattern).toContain("\\%");

    const result = await listBetaParticipants({ search: "100%-done" }, 1, 50);
    expect(result.items.some((i) => i.latestAttempt.email === literalEmail)).toBe(
      true,
    );
  });

  it("loads prior attempts excluding the latest row", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `beta-history-${suffix}@example.test`;
    const first = await trackInvitation(email);

    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });

    const second = await trackReissue(first.participantId);

    const history = await listBetaParticipantPriorAttempts(
      first.participantId,
      1,
      10,
    );
    expect(history.total).toBe(1);
    expect(history.items[0]?.id).toBe(first.id);
    expect(history.items.some((i) => i.id === second.id)).toBe(false);
  });

  it("aggregates invitation attempts and accepted participants in summary", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `beta-summary-${suffix}@example.test`;
    const invitation = await trackInvitation(email);

    const user = await prisma.user.create({
      data: {
        email: `accepted-${suffix}@example.test`,
        displayName: "Accepted User",
        passwordHash: "hash",
      },
    });
    createdUserIds.push(user.id);

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date(), issuedAt: new Date("2026-06-01T12:00:00Z") },
    });

    const reissue = await trackReissue(invitation.participantId, user.id);

    await acceptBetaInvitation(reissue.id, user.id);
    await prisma.betaParticipant.update({
      where: { id: invitation.participantId },
      data: { userId: user.id },
    });

    const result = await listBetaParticipants({ search: suffix }, 1, 50);
    expect(result.summary.totalParticipants).toBe(1);
    expect(result.summary.totalInvitationAttempts).toBe(2);
    expect(result.summary.acceptedParticipants).toBe(1);
  });

  it("returns attempt attribution fields for prior attempts", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `beta-audit-${suffix}@example.test`;
    const operator = await prisma.user.create({
      data: {
        email: `operator-${suffix}@example.test`,
        displayName: "Beta Operator",
        passwordHash: "hash",
      },
    });
    createdUserIds.push(operator.id);

    const first = await trackInvitation(email);
    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: {
        revokedAt: new Date(),
        revokedByUserId: operator.id,
        notes: "First attempt notes",
      },
    });

    await trackReissue(first.participantId, operator.id);

    const history = await listBetaParticipantPriorAttempts(
      first.participantId,
      1,
      10,
    );
    expect(history.total).toBe(1);
    expect(history.items[0]?.notes).toBe("First attempt notes");
    expect(history.items[0]?.revokedBy?.displayName).toBe("Beta Operator");
    expect(history.items[0]?.issuedBy).toBeNull();
  });

  it("uses COUNT(DISTINCT allianceId) in summary counts", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Beta Alliance ${suffix}`, server: `S-${suffix}` },
    });
    createdAllianceIds.push(alliance.id);

    const user = await prisma.user.create({
      data: {
        email: `owner-${suffix}@example.test`,
        displayName: "Owner",
        passwordHash: "hash",
      },
    });
    createdUserIds.push(user.id);

    const inv1 = await trackInvitation(`p1-${suffix}@example.test`);
    await acceptBetaInvitation(inv1.id, user.id);
    await prisma.betaInvitation.update({
      where: { id: inv1.id },
      data: { allianceId: alliance.id },
    });
    await prisma.betaParticipant.update({
      where: { id: inv1.participantId },
      data: { userId: user.id },
    });
    await prisma.allianceMembership.create({
      data: { allianceId: alliance.id, userId: user.id, role: "OWNER" },
    });

    const user2 = await prisma.user.create({
      data: {
        email: `owner2-${suffix}@example.test`,
        displayName: "Owner 2",
        passwordHash: "hash",
      },
    });
    createdUserIds.push(user2.id);

    const inv2 = await trackInvitation(`p2-${suffix}@example.test`);
    await acceptBetaInvitation(inv2.id, user2.id);
    await prisma.betaParticipant.update({
      where: { id: inv2.participantId },
      data: { userId: user2.id },
    });
    await prisma.allianceMembership.create({
      data: { allianceId: alliance.id, userId: user2.id, role: "OWNER" },
    });

    const result = await listBetaParticipants({ search: suffix }, 1, 50);
    expect(result.summary.distinctAlliancesCreated).toBe(1);
  });
});
