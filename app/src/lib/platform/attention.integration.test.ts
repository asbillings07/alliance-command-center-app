import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getActionRequired } from "./attention";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("attention beta consolidation [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdAllianceIds: string[] = [];
  const createdCollabInvitationIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: (typeof import("../betaInvitation"))["issueBetaInvitation"];
  let acceptBetaInvitation: (typeof import("../betaInvitation"))["acceptBetaInvitation"];

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ issueBetaInvitation, acceptBetaInvitation } = await import("../betaInvitation"));
  });

  afterEach(async () => {
    if (createdCollabInvitationIds.length > 0) {
      await prisma.invitation.deleteMany({
        where: { id: { in: createdCollabInvitationIds } },
      });
      createdCollabInvitationIds.length = 0;
    }
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

  async function trackInvitation(email: string) {
    const result = await issueBetaInvitation(email);
    createdInvitationIds.push(result.invitation.id);
    createdParticipantIds.push(result.invitation.participantId);
    return result.invitation;
  }

  it("does not query betaInvitation directly for attention derivation", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "attention.ts"),
      "utf8",
    );
    expect(source).not.toContain("betaInvitation.findMany");
    expect(source).toContain("listBetaParticipantsNeedingAttention");
  });

  it("returns one critical item for accepted_no_alliance from the authoritative projection", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date("2026-07-29T12:00:00Z");
    const acceptedAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    const invitation = await trackInvitation(`accepted-no-a-${suffix}@example.test`);
    const user = await prisma.user.create({
      data: {
        email: `user-${suffix}@example.test`,
        displayName: "Accepted No Alliance",
        passwordHash: "hash",
      },
    });
    createdUserIds.push(user.id);

    await acceptBetaInvitation(invitation.id, user.id);
    await prisma.betaParticipant.update({
      where: { id: invitation.participantId },
      data: { userId: user.id },
    });
    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt },
    });

    const items = await getActionRequired(now);
    const matches = items.filter(
      (item) => item.metadata?.participantId === invitation.participantId,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("critical");
    expect(matches[0]?.href).toBe(
      "/platform/beta?attentionReason=accepted_no_alliance",
    );
    expect(matches[0]?.description).toContain("8 days ago");
  });

  it("returns one warning item for invitation_expired and not per invitation row", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date("2026-07-29T12:00:00Z");
    const email = `expired-attention-${suffix}@example.test`;

    const invitation = await trackInvitation(email);
    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: {
        expiresAt: new Date("2026-07-20T12:00:00Z"),
        issuedAt: new Date("2026-07-01T12:00:00Z"),
      },
    });

    const items = await getActionRequired(now);
    const matches = items.filter((item) => item.description.includes(email));

    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.href).toBe("/platform/beta?attentionReason=invitation_expired");
  });

  it("still returns non-beta collaborator stale invite warnings", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date("2026-07-29T12:00:00Z");

    const owner = await prisma.user.create({
      data: {
        email: `owner-${suffix}@example.test`,
        displayName: "Owner",
        passwordHash: "hash",
      },
    });
    createdUserIds.push(owner.id);

    const alliance = await prisma.alliance.create({
      data: {
        name: `Collab Alliance ${suffix}`,
        server: "1001",
      },
    });
    createdAllianceIds.push(alliance.id);

    await prisma.allianceMembership.create({
      data: {
        allianceId: alliance.id,
        userId: owner.id,
        role: "OWNER",
      },
    });

    const collabInvite = await prisma.invitation.create({
      data: {
        allianceId: alliance.id,
        invitedById: owner.id,
        email: `collab-${suffix}@example.test`,
        playerNameSnapshot: "Pending Collab",
        membershipRole: "LEADER",
        token: `collab-token-${suffix}`,
        expiresAt: new Date("2026-08-29T12:00:00Z"),
        createdAt: new Date("2026-07-10T12:00:00Z"),
      },
    });
    createdCollabInvitationIds.push(collabInvite.id);

    const items = await getActionRequired(now);
    const collabItem = items.find((item) => item.id === `old-collab-${collabInvite.id}`);

    expect(collabItem?.severity).toBe("warning");
    expect(collabItem?.title).toBe("Pending collaborator invitation");
    expect(collabItem?.href).toBe(`/platform/support/alliance/${alliance.id}`);
  });

  it("still returns recent alliance no-metrics info items", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date("2026-07-29T12:00:00Z");

    const alliance = await prisma.alliance.create({
      data: {
        name: `Recent No Metrics ${suffix}`,
        server: "1002",
        createdAt: new Date("2026-07-25T12:00:00Z"),
      },
    });
    createdAllianceIds.push(alliance.id);

    const items = await getActionRequired(now);
    const infoItem = items.find((item) => item.id === `no-metrics-${alliance.id}`);

    expect(infoItem?.severity).toBe("info");
    expect(infoItem?.title).toBe("No metrics configured");
  });
});
