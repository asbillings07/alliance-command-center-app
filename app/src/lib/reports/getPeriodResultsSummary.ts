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

  const activeMetricIds = period.periodMetrics.map((pm) => pm.metric.id);

  if (activeMetricIds.length === 0) {
    return {
      participatingMemberCount: 0,
      currentActiveMemberCount,
      participatingActiveMemberCount: 0,
      metrics: [],
    };
  }

  const distinctMemberMetricPairs = await prisma.memberMetricEntry.groupBy({
    by: ["allianceMemberId", "metricId"],
    where: {
      periodId,
      metricId: { in: activeMetricIds },
      allianceMember: { allianceId },
    },
  });

  const participatingMemberIdsList = Array.from(
    new Set(distinctMemberMetricPairs.map((p) => p.allianceMemberId))
  );

  const activeMembers =
    participatingMemberIdsList.length > 0
      ? await prisma.allianceMember.findMany({
          where: {
            id: { in: participatingMemberIdsList },
            allianceId,
            archivedAt: null,
          },
          select: { id: true },
        })
      : [];

  const activeMemberIdSet = new Set(activeMembers.map((m) => m.id));

  const participatingMemberIds = new Set<string>();
  const participatingActiveMemberIds = new Set<string>();

  const entriesByMetric = new Map<
    string,
    { memberIds: Set<string>; activeMemberIds: Set<string> }
  >();

  for (const pair of distinctMemberMetricPairs) {
    participatingMemberIds.add(pair.allianceMemberId);
    const isMemberActive = activeMemberIdSet.has(pair.allianceMemberId);

    if (isMemberActive) {
      participatingActiveMemberIds.add(pair.allianceMemberId);
    }

    let metricBuckets = entriesByMetric.get(pair.metricId);
    if (!metricBuckets) {
      metricBuckets = { memberIds: new Set(), activeMemberIds: new Set() };
      entriesByMetric.set(pair.metricId, metricBuckets);
    }

    metricBuckets.memberIds.add(pair.allianceMemberId);
    if (isMemberActive) {
      metricBuckets.activeMemberIds.add(pair.allianceMemberId);
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
