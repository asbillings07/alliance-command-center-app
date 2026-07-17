"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  issueBetaInvitation,
  revokeBetaInvitation,
} from "@/app/src/lib/betaInvitation";

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
    }
  | {
      success: false;
      error: string;
    };

export type RevokeInvitationResult =
  | { success: true }
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

    return {
      success: true,
      inviteCode: result.inviteCode,
      inviteUrl: result.inviteUrl,
      email: result.invitation.email,
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
