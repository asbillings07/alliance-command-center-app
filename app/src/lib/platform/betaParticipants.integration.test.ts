import { describe, it, expect, beforeAll, afterEach } from "vitest";
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
  let acceptBetaInvitation: (typeof import("../betaInvitation"))["acceptBetaInvitation"];

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "http://localhost:3000";
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ issueBetaInvitation, acceptBetaInvitation } = await import("../betaInvitation"));
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

  it("returns empty results when no participants exist for a unique search", async () => {
    const result = await listBetaParticipants(
      { search: `no-match-${Date.now()}@example.test` },
      1,
      10,
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
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

    for (const email of emails) {
      await trackInvitation(email);
    }

    const page1 = await listBetaParticipants({ search: suffix }, 1, 2);
    const page2 = await listBetaParticipants({ search: suffix }, 2, 2);
    const pageBeyond = await listBetaParticipants({ search: suffix }, 99, 2);

    expect(page1.items).toHaveLength(2);
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    expect(pageBeyond.items).toHaveLength(0);

    const ids = [...page1.items, ...page2.items].map((i) => i.participantId);
    expect(new Set(ids).size).toBe(ids.length);
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

    const second = await trackInvitation(email);
    expect(second.participantId).toBe(first.participantId);
    createdInvitationIds.push(second.id);

    const history = await listBetaParticipantPriorAttempts(
      first.participantId,
      1,
      10,
    );
    expect(history.total).toBe(1);
    expect(history.items[0]?.id).toBe(first.id);
    expect(history.items.some((i) => i.id === second.id)).toBe(false);
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
