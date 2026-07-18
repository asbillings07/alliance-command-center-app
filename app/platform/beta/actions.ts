"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  issueBetaInvitation,
  isPendingInvitation,
  revokeBetaInvitation,
} from "@/app/src/lib/betaInvitation";
import { prisma } from "@/app/src/lib/prisma";
import { getRedeemUrl } from "@/app/src/lib/appUrl";
import { emailService } from "@/app/src/lib/email";
import type { EmailStatus } from "@/app/src/lib/email";

/**
 * Validate email format.
 * More robust than just checking for "@" - validates structure server-side
 * since browser validation can be bypassed.
 */
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;

  const trimmed = email.trim();

  // Basic length checks
  if (trimmed.length < 5 || trimmed.length > 254) return false;

  // No whitespace allowed
  if (/\s/.test(trimmed)) return false;

  // RFC 5322 simplified: local@domain.tld
  // - Local part: at least 1 char before @
  // - Domain: at least 1 char, must contain a dot, at least 2 chars after last dot
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  return emailRegex.test(trimmed);
}

/**
 * Structured result types for beta invitation actions.
 * Keeps error handling simple and predictable in client components.
 */

export type CreateInvitationResult =
  | {
      success: true;
      inviteCode: string;
      inviteUrl: string;
      email: string;
      emailStatus: EmailStatus;
    }
  | {
      success: false;
      error: string;
    };

export type RevokeInvitationResult =
  | { success: true }
  | { success: false; error: string };

export type ResendInvitationEmailResult =
  | { success: true; emailStatus: EmailStatus }
  | { success: false; error: string };

/**
 * Create a beta invitation.
 *
 * @param email - Email address to invite
 * @param notes - Optional context (e.g., "Met at conference", "Alliance: DAY1")
 */
export async function createInvitationAction(
  email: string,
  notes?: string
): Promise<CreateInvitationResult> {
  await requirePlatformAdmin();

  if (!isValidEmail(email)) {
    return { success: false, error: "Please enter a valid email address" };
  }

  try {
    const result = await issueBetaInvitation(email, { notes });
    revalidatePath("/platform/beta");

    // Email is a notification, not part of issuing the invitation. Delivery
    // failures must never invalidate a persisted invitation, so we send after
    // the fact and surface status instead of throwing.
    const { status: emailStatus } = await emailService.sendBetaInvitation({
      to: result.invitation.email,
      invitation: {
        id: result.invitation.id,
        email: result.invitation.email,
        inviteUrl: result.inviteUrl,
        inviteCode: result.inviteCode,
        expiresAt: result.invitation.expiresAt,
      },
    });

    return {
      success: true,
      inviteCode: result.inviteCode,
      inviteUrl: result.inviteUrl,
      email: result.invitation.email,
      emailStatus,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create invitation",
    };
  }
}

/**
 * Resend the invitation email for an existing pending invitation.
 *
 * Does not mutate the invitation; it only re-delivers the notification. Only
 * pending invitations can be resent (accepted/expired/revoked are terminal).
 */
export async function resendInvitationEmailAction(
  invitationId: string
): Promise<ResendInvitationEmailResult> {
  await requirePlatformAdmin();

  try {
    const invitation = await prisma.betaInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      return { success: false, error: "Invitation not found" };
    }

    if (!isPendingInvitation(invitation)) {
      return {
        success: false,
        error: "Only pending invitations can be resent",
      };
    }

    const { status: emailStatus } = await emailService.sendBetaInvitation({
      to: invitation.email,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        inviteUrl: getRedeemUrl(invitation.token),
        inviteCode: invitation.code,
        expiresAt: invitation.expiresAt,
      },
    });

    return { success: true, emailStatus };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to resend email",
    };
  }
}

/**
 * Revoke a beta invitation.
 * Sets revokedAt timestamp, preserving audit history.
 */
export async function revokeInvitationAction(
  invitationId: string
): Promise<RevokeInvitationResult> {
  await requirePlatformAdmin();

  try {
    await revokeBetaInvitation(invitationId);
    revalidatePath("/platform/beta");

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to revoke invitation",
    };
  }
}
