import { prisma } from "../prisma";
import { metricPeriodChronologicalOrderBy } from "../metricPeriodOrdering";

export type TargetPeriod = {
  id: string;
  name: string;
  periodMetrics: { metricId: string }[];
};

/**
 * Resolve the alliance's current evaluation period: the latest active period by
 * startsAt. Returns null when no active period exists (including archived-only).
 */
export async function resolveTargetPeriod(
  allianceId: string,
): Promise<TargetPeriod | null> {
  return prisma.metricPeriod.findFirst({
    where: { allianceId, active: true },
    orderBy: metricPeriodChronologicalOrderBy,
    select: {
      id: true,
      name: true,
      periodMetrics: {
        where: { active: true, metric: { active: true } },
        select: { metricId: true },
      },
    },
  });
}
