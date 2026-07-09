import { notFound, redirect } from "next/navigation";
import { prisma } from "../prisma";

/**
 * Verifies that the user has access to view/edit the specified AllianceMember.
 * Returns both the AllianceMembership (user's role in the alliance) and the AllianceMember record.
 */
export const requireAllianceMemberAccess = async (
  allianceMemberId: string,
  userId: string,
) => {
  const allianceMember = await prisma.allianceMember.findUnique({
    where: {
      id: allianceMemberId,
    },
  });

  if (!allianceMember) {
    notFound();
  }

  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId: allianceMember.allianceId,
        userId,
      },
    },
  });

  if (!membership) {
    redirect("/app");
  }

  return { membership, allianceMember };
};

/**
 * @deprecated Use requireAllianceMemberAccess instead
 */
export const requireMembershipAccess = requireAllianceMemberAccess;
