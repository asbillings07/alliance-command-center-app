import { prisma } from "./prisma";
import type { Alliance } from "@/app/generated/prisma/client";

export type CreateAllianceInput = {
  name: string;
  userId: string;
  betaInvitationId: string;
};

export type CreateAllianceResult = {
  alliance: Alliance;
  alreadyExisted: boolean;
};

/**
 * Create an alliance and make the user the OWNER.
 *
 * This is an idempotent operation: if the beta invitation is already
 * linked to an alliance, the existing alliance is returned instead of
 * creating a new one. This protects against double-clicks, retries,
 * browser refreshes, and network hiccups.
 *
 * Transaction steps:
 * 1. Check if BetaInvitation.allianceId already set → return existing alliance
 * 2. Create Alliance record
 * 3. Create AllianceMembership with role OWNER
 * 4. Update BetaInvitation.allianceId
 */
export async function createAlliance(
  input: CreateAllianceInput
): Promise<CreateAllianceResult> {
  const { name, userId, betaInvitationId } = input;

  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Alliance name is required");
  }

  const betaInvitation = await prisma.betaInvitation.findUnique({
    where: { id: betaInvitationId },
    include: { alliance: true },
  });

  if (!betaInvitation) {
    throw new Error("Beta invitation not found");
  }

  if (betaInvitation.acceptedByUserId !== userId) {
    throw new Error("This beta invitation was not accepted by you");
  }

  if (betaInvitation.allianceId && betaInvitation.alliance) {
    return {
      alliance: betaInvitation.alliance,
      alreadyExisted: true,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const alliance = await tx.alliance.create({
      data: {
        name: trimmedName,
        server: "default",
      },
    });

    await tx.allianceMembership.create({
      data: {
        allianceId: alliance.id,
        userId,
        role: "OWNER",
      },
    });

    await tx.betaInvitation.update({
      where: { id: betaInvitationId },
      data: { allianceId: alliance.id },
    });

    return alliance;
  });

  return {
    alliance: result,
    alreadyExisted: false,
  };
}
