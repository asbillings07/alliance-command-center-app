import { prisma } from "../prisma";

export async function requireAllianceAccess(
  allianceId: string,
  userId: string,
) {
  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId,
        userId,
      },
    },
  });

  if (!membership) {
    throw new Error("Unauthorized");
  }

  return membership;
}
