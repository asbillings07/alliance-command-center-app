"use server";

import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";
import {
  inviteLeadershipCollaborator,
  searchMembers,
  cancelInvitation,
  resendInvitation,
} from "@/app/src/lib/inviteLeadershipCollaborator";
import type { AllianceRole } from "@/app/generated/prisma/client";
import type { EmailStatus } from "@/app/src/lib/email";
import { deliverCollaboratorInvitation, isSingleRecipient } from "./delivery";

type InviteCollaboratorInput = {
  allianceId: string;
  existingMemberId?: string;
  playerName: string;
  email: string;
  membershipRole: "ADMIN" | "LEADER" | "VIEWER";
  thp?: number;
  squadPower?: number;
};

type InviteResult = {
  data?: {
    inviteUrl: string;
    inviteCode: string;
    memberCreated: boolean;
    emailStatus: EmailStatus | "unknown";
  };
  error?: string;
};

export async function inviteCollaborator(
  input: InviteCollaboratorInput
): Promise<InviteResult> {
  const auth = await requireAllianceAccess({ allianceId: input.allianceId });

  if (!auth.permissions.canInviteCollaborators) {
    return { error: "You don't have permission to invite collaborators" };
  }

  if (!isSingleRecipient(input.email) || typeof input.playerName !== "string" || !input.playerName.trim()
    || !["ADMIN", "LEADER", "VIEWER"].includes(input.membershipRole)) {
    return { error: "Enter one valid email address, a player name and an allowed collaborator role." };
  }

  try {
    const result = await inviteLeadershipCollaborator({
      allianceId: input.allianceId,
      invitedById: auth.user.id,
      existingMemberId: input.existingMemberId,
      playerName: input.playerName,
      email: input.email,
      membershipRole: input.membershipRole as AllianceRole,
      thp: input.thp ?? null,
      squadPower: input.squadPower ?? null,
    });

    const emailStatus = await deliverCollaboratorInvitation(result.invitation, result.inviteUrl);

    revalidatePath(`/alliances/${input.allianceId}/settings/invitations`);

    return {
      data: {
        inviteUrl: result.inviteUrl,
        inviteCode: result.inviteCode,
        memberCreated: result.memberCreated,
        emailStatus,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to create invitation" };
  }
}

export async function searchMembersAction(
  allianceId: string,
  query: string
): Promise<{ id: string; playerName: string }[]> {
  const auth = await requireAllianceAccess({ allianceId });

  if (!auth.permissions.canInviteCollaborators) {
    return [];
  }

  return searchMembers(allianceId, query);
}

export async function cancelInvitationAction(
  allianceId: string,
  invitationId: string
): Promise<{ error?: string }> {
  const auth = await requireAllianceAccess({ allianceId });

  if (!auth.permissions.canInviteCollaborators) {
    return { error: "You don't have permission to cancel invitations" };
  }

  // Query scoped by both id and allianceId for safety
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, allianceId },
    select: { id: true },
  });

  if (!invitation) {
    return { error: "Invitation not found" };
  }

  try {
    await cancelInvitation(invitationId);
    revalidatePath(`/alliances/${allianceId}/settings/invitations`);
    return {};
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to cancel invitation" };
  }
}

export async function resendInvitationAction(
  allianceId: string,
  invitationId: string
): Promise<{ data?: { inviteUrl: string; inviteCode: string; emailStatus: EmailStatus | "unknown" }; error?: string }> {
  const auth = await requireAllianceAccess({ allianceId });

  if (!auth.permissions.canInviteCollaborators) {
    return { error: "You don't have permission to resend invitations" };
  }

  // Query scoped by both id and allianceId for safety
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, allianceId },
    select: { id: true, email: true, membershipRole: true },
  });

  if (!invitation) {
    return { error: "Invitation not found" };
  }

  if (!isSingleRecipient(invitation.email) || !["ADMIN", "LEADER", "VIEWER"].includes(invitation.membershipRole)) {
    return { error: "This invitation has an invalid email address or role. Cancel it and create a new invitation with the correct details." };
  }

  try {
    const result = await resendInvitation(invitationId);
    const emailStatus = await deliverCollaboratorInvitation(result.invitation, result.inviteUrl);
    revalidatePath(`/alliances/${allianceId}/settings/invitations`);
    return {
      data: {
        inviteUrl: result.inviteUrl,
        inviteCode: result.inviteCode,
        emailStatus,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to resend invitation" };
  }
}
