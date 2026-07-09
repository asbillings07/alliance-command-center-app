"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { prisma } from "@/app/src/lib/prisma";

type ConfirmResult = {
  error?: string;
};

export async function confirmMember(
  allianceId: string,
  memberId: string | null
): Promise<ConfirmResult> {
  const user = await requireAuth();

  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    return { error: "You are not a member of this alliance" };
  }

  // Check if user is already linked to another AllianceMember in this alliance
  const existingRosterLink = await prisma.allianceMember.findFirst({
    where: {
      allianceId,
      userId: user.id,
    },
  });

  if (existingRosterLink) {
    return { error: "You are already linked to a roster member in this alliance" };
  }

  if (memberId) {
    const member = await prisma.allianceMember.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      return { error: "Member not found" };
    }

    if (member.allianceId !== allianceId) {
      return { error: "Member does not belong to this alliance" };
    }

    if (member.userId !== null) {
      return { error: "This member is already linked to another account" };
    }

    if (member.archivedAt !== null) {
      return { error: "Cannot link to an archived member" };
    }

    await prisma.allianceMember.update({
      where: { id: memberId },
      data: { userId: user.id },
    });
  }

  revalidatePath(`/alliances/${allianceId}`);

  return {};
}
