"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
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
  const user = await requireAuth();

  const membership = await requireLeadershipAccess(input.allianceId, user.id);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return { error: "Only owners and admins can invite collaborators" };
  }

  try {
    const result = await inviteLeadershipCollaborator({
      allianceId: input.allianceId,
      invitedById: user.id,
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
  const user = await requireAuth();
  await requireLeadershipAccess(allianceId, user.id);

  return searchMembers(allianceId, query);
}

export async function cancelInvitationAction(
  allianceId: string,
  invitationId: string
): Promise<{ error?: string }> {
  const user = await requireAuth();

  const membership = await requireLeadershipAccess(allianceId, user.id);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return { error: "Only owners and admins can cancel invitations" };
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
  const user = await requireAuth();

  const membership = await requireLeadershipAccess(allianceId, user.id);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return { error: "Only owners and admins can resend invitations" };
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
