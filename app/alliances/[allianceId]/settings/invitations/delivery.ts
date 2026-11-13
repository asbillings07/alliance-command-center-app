import "server-only";
import { emailService, type EmailStatus } from "@/app/src/lib/email";
import { isValidEmailFormat } from "@/app/src/lib/emailAddress";
import type { Invitation } from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";

export function isSingleRecipient(value: unknown): value is string {
  return typeof value === "string" && isValidEmailFormat(value) && !/[,;<>]/.test(value);
}

/** Called by authorized actions after persistence; never inside a transaction. */
export async function deliverCollaboratorInvitation(invitation: Invitation, inviteUrl: string): Promise<EmailStatus | "unknown"> {
  if (!isSingleRecipient(invitation.email) || !invitation.code || !["ADMIN", "LEADER", "VIEWER"].includes(invitation.membershipRole)) {
    console.warn("[collaborator-invitation] Email skipped: invalid stored recipient or role", { invitationId: invitation.id });
    return "skipped";
  }
  try {
    const alliance = await prisma.alliance.findUniqueOrThrow({ where: { id: invitation.allianceId }, select: { name: true } });
    const result = await emailService.sendCollaboratorInvitation({
      to: invitation.email,
      invitation: {
        id: invitation.id, allianceName: alliance.name, playerName: invitation.playerNameSnapshot,
        role: invitation.membershipRole as "ADMIN" | "LEADER" | "VIEWER",
        inviteUrl, inviteCode: invitation.code, expiresAt: invitation.expiresAt,
      },
    });
    console.info("[collaborator-invitation] Email outcome", { invitationId: invitation.id, status: result.status, messageId: result.messageId });
    return result.status;
  } catch {
    // The invitation is already durable. Do not claim creation failed or
    // retry automatically after an unknown delivery outcome.
    console.error("[collaborator-invitation] Email outcome unknown", { invitationId: invitation.id });
    return "unknown";
  }
}
