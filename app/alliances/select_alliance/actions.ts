import { prisma } from "@/app/src/lib/prisma";

export async function selectAlliance(userId: string) {
  const memberships = await prisma.allianceMembership.findMany({
    where: {
      userId,
    },
  });
  const alliances = await prisma.alliance.findMany({
    where: {
      id: {
        in: memberships.map((membership) => membership.allianceId),
      },
    },
  });
  return alliances;
}
