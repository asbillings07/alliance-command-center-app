import { prisma } from "../prisma";
import { AllianceRole } from "@/app/generated/prisma/enums";

export const requireLeadershipAccess = async (
  allianceId: string,
  userId: string,
) => {
  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId: allianceId,
        userId: userId,
      },
    },
  });
  if (!membership) {
    throw new Error("Access Denied");
  }
  if (membership.role === AllianceRole.VIEWER) {
    throw new Error("Unauthorized");
  }

  return membership;
};
