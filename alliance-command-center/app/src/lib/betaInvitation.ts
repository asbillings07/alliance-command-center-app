import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import type { BetaInvitation } from "@/app/generated/prisma/client";

function generateBetaCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = chars.length;
  const limit = 256 - (256 % len);

  const randomChar = (): string => {
    let byte: number;
    do {
      byte = randomBytes(1)[0];
    } while (byte >= limit);
    return chars[byte % len];
  };

  const segment = () => Array.from({ length: 3 }, randomChar).join("");
  return `${segment()}-${segment()}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export type CreateBetaInvitationResult = {
  invitation: BetaInvitation;
  inviteUrl: string;
  inviteCode: string;
};

/**
 * Create a beta invitation for a new user.
 * Used by admin to invite beta testers.
 */
export async function createBetaInvitation(
  email: string
): Promise<CreateBetaInvitationResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.betaInvitation.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    throw new Error("A beta invitation already exists for this email");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    const membership = await prisma.allianceMembership.findFirst({
      where: { userId: existingUser.id },
    });

    if (membership) {
      throw new Error("This user already has access to an alliance");
    }
  }

  const token = randomUUID();
  const code = generateBetaCode();

  const invitation = await prisma.betaInvitation.create({
    data: {
      email: normalizedEmail,
      token,
      code,
      expiresAt: addDays(new Date(), 30),
    },
  });

  const origin = process.env.NEXTAUTH_URL || "http://localhost:3000";

  return {
    invitation,
    inviteUrl: `${origin}/redeem/${token}`,
    inviteCode: code,
  };
}

/**
 * Validate a beta invitation token.
 * Returns the invitation if valid, null otherwise.
 */
export async function validateBetaToken(
  token: string
): Promise<BetaInvitation | null> {
  const invitation = await prisma.betaInvitation.findUnique({
    where: { token },
  });

  if (!invitation) {
    return null;
  }

  if (invitation.expiresAt < new Date()) {
    return null;
  }

  return invitation;
}

/**
 * Validate a beta invitation code (6-digit human-readable).
 * Returns the invitation if valid, null otherwise.
 */
export async function validateBetaCode(
  code: string
): Promise<BetaInvitation | null> {
  const normalizedCode = code.toUpperCase().trim();

  const invitation = await prisma.betaInvitation.findUnique({
    where: { code: normalizedCode },
  });

  if (!invitation) {
    return null;
  }

  if (invitation.expiresAt < new Date()) {
    return null;
  }

  return invitation;
}

/**
 * Accept a beta invitation for a user.
 * Called when a user completes the /redeem flow.
 */
export async function acceptBetaInvitation(
  invitationId: string,
  userId: string
): Promise<BetaInvitation> {
  const invitation = await prisma.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  if (invitation.acceptedAt) {
    if (invitation.acceptedByUserId === userId) {
      return invitation;
    }
    throw new Error("This beta invitation has already been accepted");
  }

  if (invitation.expiresAt < new Date()) {
    throw new Error("This beta invitation has expired");
  }

  return prisma.betaInvitation.update({
    where: { id: invitationId },
    data: {
      acceptedAt: new Date(),
      acceptedByUserId: userId,
    },
  });
}

/**
 * Find a pending alliance creation for a user.
 * Returns the accepted beta invitation if the user has accepted one
 * but hasn't yet created an alliance.
 */
export async function getPendingAllianceCreation(
  userId: string
): Promise<BetaInvitation | null> {
  const acceptedInvitation = await prisma.betaInvitation.findFirst({
    where: {
      acceptedByUserId: userId,
      allianceId: null,
    },
  });

  return acceptedInvitation;
}

/**
 * Get beta invitation by user ID.
 * Returns the user's accepted beta invitation, if any.
 */
export async function getBetaInvitationByUser(
  userId: string
): Promise<BetaInvitation | null> {
  return prisma.betaInvitation.findFirst({
    where: { acceptedByUserId: userId },
  });
}
