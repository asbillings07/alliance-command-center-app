"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  createBetaInvitation,
  revokeBetaInvitation,
} from "@/app/src/lib/betaInvitation";

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

  if (!email || !email.includes("@")) {
    return { success: false, error: "Please enter a valid email address" };
  }

  try {
    const result = await createBetaInvitation(email, notes);
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
