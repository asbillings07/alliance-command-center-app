"use server";

import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";

type ConfirmResult = {
  error?: string;
};

export async function confirmMember(
  allianceId: string,
  memberId: string | null
): Promise<ConfirmResult> {
  // Authorize first - ensures user is authenticated and member of this alliance
  const auth = await requireAllianceAccess({ allianceId });

  // Check if user is already linked to another AllianceMember in this alliance
  const existingRosterLink = await prisma.allianceMember.findFirst({
    where: {
      allianceId,
      userId: auth.user.id,
    },
  });

  if (existingRosterLink) {
    return { error: "You are already linked to a roster member in this alliance" };
  }

  if (memberId) {
    // Query scoped by both id and allianceId to prevent enumeration
    const member = await prisma.allianceMember.findFirst({
      where: { id: memberId, allianceId },
    });

    if (!member) {
      return { error: "Member not found" };
    }

    if (member.userId !== null) {
      return { error: "This member is already linked to another account" };
    }

    if (member.archivedAt !== null) {
      return { error: "Cannot link to an archived member" };
    }

    await prisma.allianceMember.update({
      where: { id: memberId },
      data: { userId: auth.user.id },
    });
  }

  revalidatePath(`/alliances/${allianceId}`);

  return {};
}
