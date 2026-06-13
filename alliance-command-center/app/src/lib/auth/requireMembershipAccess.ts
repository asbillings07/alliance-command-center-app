import { prisma } from "../prisma";

export const requireMembershipAccess = async (
  memberId: string,
  userId: string,
) => {
  const member = await prisma.member.findUnique({
    where: {
      id: memberId,
    },
    include: {
      alliance: true,
    },
  });

  if (!member) {
    throw new Error("Member not found");
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
    throw new Error("Unauthorized");
  }

  return { membership, member };
};
