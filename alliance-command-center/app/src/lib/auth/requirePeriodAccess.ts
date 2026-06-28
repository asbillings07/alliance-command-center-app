import { redirect } from "next/navigation";
import { prisma } from "../prisma";
import { AllianceRole } from "@/app/generated/prisma/enums";

export const requirePeriodAccess = async (periodId: string, userId: string) => {
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
    include: {
      alliance: true,
    },
  });
  if (!period) {
    throw new Error("Period not found");
  }
  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId: period.allianceId,
        userId,
      },
    },
  });
  if (!membership) {
    redirect("/app");
  }

  if (membership.role === AllianceRole.VIEWER) {
    redirect("/app");
  }

  return { period, membership };
};
