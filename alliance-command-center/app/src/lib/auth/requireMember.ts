import { prisma } from "../prisma";
import { notFound } from "next/navigation";

export async function requireAllianceMember(allianceMemberId: string) {
  const allianceMember = await prisma.allianceMember.findUnique({
    where: {
      id: allianceMemberId,
    },
  });
  if (!allianceMember) {
    notFound();
  }
  return allianceMember;
}

/**
 * @deprecated Use requireAllianceMember instead
 */
export const requireMember = requireAllianceMember;
