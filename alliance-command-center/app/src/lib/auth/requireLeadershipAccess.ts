import { prisma } from "../prisma";
import { AllianceRole } from "@/app/generated/prisma/enums";
import { redirect, notFound } from "next/navigation";

/**
 * @deprecated Use requireAllianceAccess with a specific permission instead.
 * This function uses direct role comparison which bypasses the capability-based
 * authorization architecture. See ADR-007.
 */
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
    notFound();
  }
  if (membership.role === AllianceRole.VIEWER) {
    redirect("/app");
  }

  return membership;
};
