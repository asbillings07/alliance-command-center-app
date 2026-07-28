import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as BetaInvitationModule from "./betaInvitation";

/**
 * Real-Postgres integration tests for acceptBetaInvitationWithTx identity
 * maintenance, retry-on-40001, and merge-on-23505 (#174 PR 1a).
 *
 * Run locally with: INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("betaInvitation accept identity [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: typeof BetaInvitationModule.issueBetaInvitation;
  let acceptBetaInvitation: typeof BetaInvitationModule.acceptBetaInvitation;
  let acceptBetaInvitationWithTx: typeof BetaInvitationModule.acceptBetaInvitationWithTx;

  beforeAll(async () => {
    ({ prisma } = (await import("./prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ issueBetaInvitation, acceptBetaInvitation, acceptBetaInvitationWithTx } =
      await import("./betaInvitation"));
  });

  afterEach(async () => {
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
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function makeUser() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `beta-accept-int-${suffix}@example.test`,
        displayName: "Beta Accept Integration",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function issueTrackedInvitation(email?: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await issueBetaInvitation(
      email ?? `beta-invite-int-${suffix}@example.test`,
    );
    createdInvitationIds.push(result.invitation.id);
    if (result.invitation.participantId) {
      createdParticipantIds.push(result.invitation.participantId);
    }
    return result.invitation;
  }

  it("acceptBetaInvitation sets participant userId on redeem path", async () => {
    const user = await makeUser();
    const invitation = await issueTrackedInvitation(user.email);

    const accepted = await acceptBetaInvitation(invitation.id, user.id);
    expect(accepted.acceptedByUserId).toBe(user.id);

    const participant = await prisma.betaParticipant.findFirst({
      where: { userId: user.id },
    });
    expect(participant).not.toBeNull();
    expect(accepted.participantId).toBe(participant!.id);
  });

  it("acceptBetaInvitationWithTx maintains identity inside register-style transaction", async () => {
    const invitation = await issueTrackedInvitation();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email: `register-style-${suffix}@example.test`,
            displayName: "Register Style",
            passwordHash: "placeholder-hash-not-a-real-password",
          },
        });
        createdUserIds.push(user.id);

        await acceptBetaInvitationWithTx(tx, invitation.id, user.id);
      },
      { isolationLevel: "Serializable" },
    );

    const row = await prisma.betaParticipant.findFirst({
      where: { invitations: { some: { id: invitation.id } } },
    });
    expect(row?.userId).toBeTruthy();
  });

  it("retries from scratch on a manufactured serialization failure (40001)", async () => {
    const user = await makeUser();
    const invitation = await issueTrackedInvitation(user.email);

    let attempts = 0;
    const originalTransaction = prisma.$transaction.bind(prisma);
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementation(async (fn, options) => {
        attempts++;
        if (attempts === 1) {
          const error = new Error("Serialization failure");
          (error as Error & { code: string }).code = "P2034";
          throw error;
        }
        return originalTransaction(fn as never, options as never);
      });

    try {
      const accepted = await acceptBetaInvitation(invitation.id, user.id);
      expect(accepted.acceptedByUserId).toBe(user.id);
      expect(attempts).toBe(2);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it("merges a second participant into the holder after the first accept claims userId", async () => {
    const user = await makeUser();
    const invitationA = await issueTrackedInvitation(user.email);
    await acceptBetaInvitation(invitationA.id, user.id);

    const invitationB = await issueTrackedInvitation(user.email);
    const participantB = invitationB.participantId!;

    await acceptBetaInvitation(invitationB.id, user.id);

    const holders = await prisma.betaParticipant.findMany({
      where: { userId: user.id },
    });
    expect(holders).toHaveLength(1);
    expect(holders[0].id).toBe(invitationA.participantId);

    const reassignedB = await prisma.betaInvitation.findUniqueOrThrow({
      where: { id: invitationB.id },
    });
    expect(reassignedB.participantId).toBe(holders[0].id);

    const deleted = await prisma.betaParticipant.findUnique({
      where: { id: participantB },
    });
    expect(deleted).toBeNull();
  });
});
