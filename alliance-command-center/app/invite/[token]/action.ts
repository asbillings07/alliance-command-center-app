"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { prisma } from "@/app/src/lib/prisma";

type AcceptResult = {
  redirectTo?: string;
  error?: string;
};

export async function acceptInvitation(invitationId: string): Promise<AcceptResult> {
  const user = await requireAuth();

  // Get full user record to check email
  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true },
  });

  if (!fullUser) {
    return { error: "User not found" };
  }

  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    include: {
      allianceMember: true,
    },
  });

  if (!invitation) {
    return { error: "Invitation not found" };
  }

  // Verify the authenticated user's email matches the invitation
  if (invitation.email.toLowerCase() !== fullUser.email.toLowerCase()) {
    return { error: "This invitation was sent to a different email address" };
  }

  if (invitation.acceptedAt) {
    return { error: "This invitation has already been accepted" };
  }

  if (invitation.cancelledAt) {
    return { error: "This invitation has been cancelled" };
  }

  if (invitation.expiresAt < new Date()) {
    return { error: "This invitation has expired" };
  }

  const existingMembership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId: invitation.allianceId,
        userId: user.id,
      },
    },
  });

  if (existingMembership) {
    return { error: "You are already a member of this alliance" };
  }

  // Check if user is already linked to another AllianceMember in this alliance
  const existingRosterLink = await prisma.allianceMember.findFirst({
    where: {
      allianceId: invitation.allianceId,
      userId: user.id,
    },
  });

  const canAutoLink =
    invitation.allianceMemberId &&
    invitation.allianceMember &&
    invitation.allianceMember.userId === null &&
    invitation.allianceMember.archivedAt === null &&
    !existingRosterLink; // Skip auto-link if user already has a roster link

  await prisma.$transaction(async (tx) => {
    await tx.allianceMembership.create({
      data: {
        allianceId: invitation.allianceId,
        userId: user.id,
        role: invitation.membershipRole,
      },
    });

    await tx.invitation.update({
      where: { id: invitationId },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: user.id,
      },
    });

    if (canAutoLink && invitation.allianceMemberId) {
      await tx.allianceMember.update({
        where: { id: invitation.allianceMemberId },
        data: { userId: user.id },
      });
    }
  });

  revalidatePath(`/alliances/${invitation.allianceId}`);

  if (canAutoLink) {
    return { redirectTo: `/alliances/${invitation.allianceId}` };
  } else {
    return { redirectTo: `/alliances/${invitation.allianceId}/confirm-member` };
  }
}
