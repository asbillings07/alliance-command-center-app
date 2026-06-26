import { prisma } from "../prisma";
import { redirect } from "next/navigation";

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
    redirect("/app");
  }

  return membership;
}
