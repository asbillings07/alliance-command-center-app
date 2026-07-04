import { notFound, redirect } from "next/navigation";
import { prisma } from "../prisma";
import { AllianceRole } from "@/app/generated/prisma/enums";

export const requirePeriodAccess = async (
  periodId: string,
  allianceId: string,
  userId: string,
) => {
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
    include: {
      periodMetrics: {
        include: {
          metric: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  if (!period) {
    notFound();
  }

  if (allianceId !== period.allianceId) {
    notFound();
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
