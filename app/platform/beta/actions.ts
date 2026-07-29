"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  deliverBetaInvitationEmail,
  deliverBetaInvitationEmailWithClaim,
  issueBetaInvitation,
  isPendingInvitation,
  reissueBetaInvitation,
  revokeBetaInvitation,
} from "@/app/src/lib/betaInvitation";
import {
  listBetaParticipantPriorAttempts,
  type BetaParticipantPriorAttempt,
} from "@/app/src/lib/platform/betaParticipants";
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

export type ReissueInvitationResult =
  | {
      success: true;
      inviteCode: string;
      inviteUrl: string;
      email: string;
      emailStatus: EmailStatus;
    }
  | { success: false; error: string };

export type PriorAttemptsResult =
  | {
      success: true;
      items: BetaParticipantPriorAttempt[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { success: false; error: string };

/**
 * Create a beta invitation.
 *
 * @param email - Email address to invite
 * @param notes - Optional context (e.g., "Met at conference", "Alliance: DAY1")
 * @param wave - Optional beta wave / campaign label
 */
export async function createInvitationAction(
  email: string,
  notes?: string,
  wave?: string,
): Promise<CreateInvitationResult> {
  const session = await requirePlatformAdmin();

  if (!isValidEmail(email)) {
    return { success: false, error: "Please enter a valid email address" };
  }

  try {
    const result = await issueBetaInvitation(email, {
      notes,
      campaign: wave?.trim() || undefined,
      issuedByUserId: session.id,
    });
    revalidatePath("/platform/beta");

    const emailStatus = await deliverBetaInvitationEmail(
      result.invitation,
      result.inviteUrl,
      (input) => emailService.sendBetaInvitation(input),
    );

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
 * Reissue a beta invitation for an existing participant whose latest attempt
 * is terminal (expired or revoked).
 */
export async function reissueInvitationAction(
  participantId: string,
  wave?: string,
): Promise<ReissueInvitationResult> {
  const session = await requirePlatformAdmin();

  if (!participantId) {
    return { success: false, error: "Participant not found" };
  }

  try {
    const result = await reissueBetaInvitation(participantId, session.id, {
      campaign: wave,
    });
    revalidatePath("/platform/beta");

    let emailStatus: EmailStatus = "failed";
    try {
      emailStatus = await deliverBetaInvitationEmailWithClaim(
        result.invitation,
        result.inviteUrl,
        (input) => emailService.sendBetaInvitation(input),
      );
    } catch {
      // Persisted reissue stands; only notification/claim failed (#174).
    }

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
        error instanceof Error ? error.message : "Failed to reissue invitation",
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
  invitationId: string,
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

    const emailStatus = await deliverBetaInvitationEmailWithClaim(
      invitation,
      getRedeemUrl(invitation.token),
      (input) => emailService.sendBetaInvitation(input),
    );

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
  invitationId: string,
): Promise<RevokeInvitationResult> {
  const session = await requirePlatformAdmin();

  try {
    await revokeBetaInvitation(invitationId, session.id);
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

/**
 * Load paginated prior invitation attempts for a participant (on-demand expand).
 */
export async function fetchPriorAttemptsAction(
  participantId: string,
  page = 1,
  pageSize = 10,
): Promise<PriorAttemptsResult> {
  await requirePlatformAdmin();

  if (!participantId) {
    return { success: false, error: "Participant not found" };
  }

  try {
    const participant = await prisma.betaParticipant.findUnique({
      where: { id: participantId },
      select: { id: true },
    });

    if (!participant) {
      return { success: false, error: "Participant not found" };
    }

    const result = await listBetaParticipantPriorAttempts(
      participantId,
      page,
      pageSize,
    );

    return {
      success: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load prior attempts",
    };
  }
}
