"use server";

import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import {
  inviteLeadershipCollaborator,
  searchMembers,
  cancelInvitation,
  resendInvitation,
} from "@/app/src/lib/inviteLeadershipCollaborator";
import type { AllianceRole } from "@/app/generated/prisma/client";

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
  };
  error?: string;
};

export async function inviteCollaborator(
  input: InviteCollaboratorInput
): Promise<InviteResult> {
  const auth = await requireAllianceAccess({
    allianceId: input.allianceId,
    requiredPermission: Permissions.INVITE_COLLABORATORS,
  });

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

    revalidatePath(`/alliances/${input.allianceId}/settings/invitations`);

    return {
      data: {
        inviteUrl: result.inviteUrl,
        inviteCode: result.inviteCode,
        memberCreated: result.memberCreated,
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
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.INVITE_COLLABORATORS,
  });

  return searchMembers(allianceId, query);
}

export async function cancelInvitationAction(
  allianceId: string,
  invitationId: string
): Promise<{ error?: string }> {
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.INVITE_COLLABORATORS,
  });

  // Verify invitation belongs to this alliance
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { allianceId: true },
  });

  if (!invitation || invitation.allianceId !== allianceId) {
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
): Promise<{ data?: { inviteUrl: string; inviteCode: string }; error?: string }> {
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.INVITE_COLLABORATORS,
  });

  // Verify invitation belongs to this alliance
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { allianceId: true },
  });

  if (!invitation || invitation.allianceId !== allianceId) {
    return { error: "Invitation not found" };
  }

  try {
    const result = await resendInvitation(invitationId);
    revalidatePath(`/alliances/${allianceId}/settings/invitations`);
    return {
      data: {
        inviteUrl: result.inviteUrl,
        inviteCode: result.inviteCode,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to resend invitation" };
  }
}
