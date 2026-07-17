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

export type IssueBetaInvitationResult = {
  invitation: BetaInvitation;
  inviteUrl: string;
  inviteCode: string;
};

/**
 * Determine whether an invitation is currently pending.
 * Pending = not accepted, not revoked, and not expired.
 *
 * This is the single source of truth for the "pending" business rule.
 */
export function isPendingInvitation(invitation: BetaInvitation): boolean {
  return (
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt > new Date()
  );
}

/**
 * Get the pending invitation for an email, if one exists.
 *
 * Answers the business question: "Is there a valid, usable invitation
 * for this email right now?" Queries directly for pending state rather
 * than fetching the latest record and evaluating it afterward.
 */
export async function getPendingInvitation(
  email: string
): Promise<BetaInvitation | null> {
  const normalizedEmail = email.toLowerCase().trim();

  return prisma.betaInvitation.findFirst({
    where: {
      email: normalizedEmail,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { issuedAt: "desc" },
  });
}

export type IssueBetaInvitationOptions = {
  notes?: string;
  campaign?: string;
};

/**
 * Issue a beta invitation for an email address.
 *
 * BetaInvitation is a history table: every issuance creates a new record,
 * preserving revoked and expired invitations for audit history.
 *
 * Business rules (owned entirely by this service):
 * - Only one pending invitation per email at a time
 * - Cannot invite a user who already has alliance access
 *
 * @param email - The email address to invite
 * @param options - Optional notes and campaign/wave label
 */
export async function issueBetaInvitation(
  email: string,
  options?: IssueBetaInvitationOptions
): Promise<IssueBetaInvitationResult> {
  const normalizedEmail = email.toLowerCase().trim();

  // Only one pending invitation per email
  const pending = await getPendingInvitation(normalizedEmail);
  if (pending) {
    throw new Error("A pending beta invitation already exists for this email");
  }

  // Cannot invite a user who already has alliance access
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

  const now = new Date();
  const token = randomUUID();
  const code = generateBetaCode();

  // Always create a new record - never mutate history
  const invitation = await prisma.betaInvitation.create({
    data: {
      email: normalizedEmail,
      token,
      code,
      notes: options?.notes?.trim() || null,
      campaign: options?.campaign?.trim() || null,
      expiresAt: addDays(now, 30),
      createdAt: now,
      issuedAt: now,
    },
  });

  return buildInvitationResult(invitation);
}

/**
 * Build the invitation result with URL.
 * Centralizes the NEXTAUTH_URL logic to avoid duplication.
 */
function buildInvitationResult(
  invitation: BetaInvitation
): IssueBetaInvitationResult {
  const origin = process.env.NEXTAUTH_URL;

  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXTAUTH_URL must be configured in production");
    }
    // Development/test fallback
    return {
      invitation,
      inviteUrl: `http://localhost:3000/redeem/${invitation.token}`,
      inviteCode: invitation.code,
    };
  }

  return {
    invitation,
    inviteUrl: `${origin}/redeem/${invitation.token}`,
    inviteCode: invitation.code,
  };
}

/**
 * Revoke a beta invitation.
 * Sets revokedAt timestamp to prevent the invitation from being used.
 * Does not delete the invitation, preserving audit history.
 *
 * Uses atomic update to prevent race conditions.
 */
export async function revokeBetaInvitation(invitationId: string): Promise<void> {
  // Atomic update: only revoke if not already accepted or revoked
  const result = await prisma.betaInvitation.updateMany({
    where: {
      id: invitationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    // Re-fetch to determine why update failed
    const invitation = await prisma.betaInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error("Beta invitation not found");
    }

    if (invitation.acceptedAt) {
      throw new Error("Cannot revoke an accepted invitation");
    }

    if (invitation.revokedAt) {
      throw new Error("Invitation has already been revoked");
    }

    // Shouldn't reach here, but handle gracefully
    throw new Error("Failed to revoke invitation");
  }
}

export type BetaValidationResult =
  | { status: "valid"; invitation: BetaInvitation }
  | { status: "not_found"; invitation: null }
  | { status: "expired"; invitation: null }
  | { status: "revoked"; invitation: null }
  | { status: "already_accepted"; invitation: BetaInvitation };

/**
 * Validate a beta invitation token.
 * Returns structured result with status and invitation.
 *
 * Validation order: accepted? → revoked? → expired? → valid
 */
export async function validateBetaToken(
  token: string
): Promise<BetaValidationResult> {
  const invitation = await prisma.betaInvitation.findUnique({
    where: { token },
  });

  if (!invitation) {
    return { status: "not_found", invitation: null };
  }

  if (invitation.acceptedAt) {
    return { status: "already_accepted", invitation };
  }

  if (invitation.revokedAt) {
    return { status: "revoked", invitation: null };
  }

  if (invitation.expiresAt < new Date()) {
    return { status: "expired", invitation: null };
  }

  return { status: "valid", invitation };
}

/**
 * Validate a beta invitation code (6-digit human-readable).
 * Returns structured result with status and invitation.
 *
 * Validation order: accepted? → revoked? → expired? → valid
 */
export async function validateBetaCode(
  code: string
): Promise<BetaValidationResult> {
  const normalizedCode = code.toUpperCase().trim();

  const invitation = await prisma.betaInvitation.findUnique({
    where: { code: normalizedCode },
  });

  if (!invitation) {
    return { status: "not_found", invitation: null };
  }

  if (invitation.acceptedAt) {
    return { status: "already_accepted", invitation };
  }

  if (invitation.revokedAt) {
    return { status: "revoked", invitation: null };
  }

  if (invitation.expiresAt < new Date()) {
    return { status: "expired", invitation: null };
  }

  return { status: "valid", invitation };
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

  if (invitation.revokedAt) {
    throw new Error("This beta invitation has been revoked");
  }

  if (invitation.expiresAt < new Date()) {
    throw new Error("This beta invitation has expired");
  }

  const now = new Date();

  // Atomic update: only accept if still valid (not accepted, not revoked)
  const updated = await prisma.betaInvitation.updateMany({
    where: {
      id: invitationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: {
      acceptedAt: now,
      acceptedByUserId: userId,
    },
  });

  if (updated.count !== 1) {
    // Re-fetch to determine why update failed
    const current = await prisma.betaInvitation.findUnique({
      where: { id: invitationId },
    });
    if (current && current.acceptedByUserId === userId) {
      return current;
    }
    if (current?.revokedAt) {
      throw new Error("This beta invitation has been revoked");
    }
    throw new Error("This beta invitation has already been accepted");
  }

  const accepted = await prisma.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!accepted) {
    throw new Error("Beta invitation not found");
  }

  return accepted;
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
