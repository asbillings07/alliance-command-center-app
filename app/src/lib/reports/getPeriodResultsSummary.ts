import "server-only";
import { prisma } from "@/app/src/lib/prisma";

export type MetricCoverageSummary = {
  metricId: string;
  metricName: string;
  memberCount: number;
  activeMemberCount: number;
};

export type PeriodResultsSummary = {
  participatingMemberCount: number;
  currentActiveMemberCount: number;
  participatingActiveMemberCount: number;
  metrics: MetricCoverageSummary[];
};

export async function getPeriodResultsSummary(params: {
  allianceId: string;
  periodId: string;
}): Promise<PeriodResultsSummary> {
  const { allianceId, periodId } = params;

  if (!allianceId || !periodId) {
    throw new Error("allianceId and periodId are required");
  }

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
    select: {
      id: true,
      periodMetrics: {
        where: { active: true },
        select: {
          metric: {
            select: { id: true, name: true },
          },
        },
        orderBy: {
          metric: { name: "asc" },
        },
      },
    },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  const currentActiveMemberCount = await prisma.allianceMember.count({
    where: { allianceId, archivedAt: null },
  });

  const entries = await prisma.memberMetricEntry.findMany({
    where: {
      periodId,
      allianceMember: { allianceId },
    },
    select: {
      allianceMemberId: true,
      metricId: true,
      allianceMember: {
        select: { archivedAt: true },
      },
    },
  });

  const participatingMemberIds = new Set<string>();
  const participatingActiveMemberIds = new Set<string>();

  const entriesByMetric = new Map<
    string,
    { memberIds: Set<string>; activeMemberIds: Set<string> }
  >();

  for (const entry of entries) {
    participatingMemberIds.add(entry.allianceMemberId);
    const isMemberActive = entry.allianceMember.archivedAt === null;

    if (isMemberActive) {
      participatingActiveMemberIds.add(entry.allianceMemberId);
    }

    let metricBuckets = entriesByMetric.get(entry.metricId);
    if (!metricBuckets) {
      metricBuckets = { memberIds: new Set(), activeMemberIds: new Set() };
      entriesByMetric.set(entry.metricId, metricBuckets);
    }

    metricBuckets.memberIds.add(entry.allianceMemberId);
    if (isMemberActive) {
      metricBuckets.activeMemberIds.add(entry.allianceMemberId);
    }
  }

  const metrics: MetricCoverageSummary[] = period.periodMetrics.map((pm) => {
    const buckets = entriesByMetric.get(pm.metric.id);
    return {
      metricId: pm.metric.id,
      metricName: pm.metric.name,
      memberCount: buckets ? buckets.memberIds.size : 0,
      activeMemberCount: buckets ? buckets.activeMemberIds.size : 0,
    };
  });

  return {
    participatingMemberCount: participatingMemberIds.size,
    currentActiveMemberCount,
    participatingActiveMemberCount: participatingActiveMemberIds.size,
    metrics,
  };
}
