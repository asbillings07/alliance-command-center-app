import { notFound, redirect } from "next/navigation";
import { prisma } from "../prisma";

export const requireMembershipAccess = async (
  memberId: string,
  userId: string,
) => {
  const member = await prisma.member.findUnique({
    where: {
      id: memberId,
    },
  });

  if (!member) {
    notFound();
  }

  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId: member.allianceId,
        userId,
      },
    },
  });

  if (!membership) {
    redirect("/app");
  }

  return { membership, member };
};
