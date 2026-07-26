"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions, hasPermission } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import {
  buildMetricImportPlan,
  type MetricMapping,
} from "@/app/src/lib/metricImport";
import { resolveMetricTargets } from "@/app/src/lib/metricResolution";
import { classifyColumn } from "@/app/src/lib/columnClassifier";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import {
  aggregateRequiredPermissions,
  planMultiPeriodImportGroup,
  validateMultiPeriodImportGroups,
  type MultiPeriodImportGroupInput,
} from "@/app/src/lib/import/multiPeriodImport";

export type MultiPeriodImportMetricsInput = {
  allianceId: string;
  groups: MultiPeriodImportGroupInput[];
};

type MetricSummary = { metricId: string; name: string };

export type MultiPeriodImportPeriodResult = {
  periodId: string;
  periodName: string;
  totalCount: number;
  perMetric: (MetricSummary & { count: number })[];
  created: MetricSummary[];
  attached: MetricSummary[];
  reused: MetricSummary[];
};

export type MultiPeriodImportMetricsResult = {
  success: boolean;
  periods: MultiPeriodImportPeriodResult[];
  totalCount: number;
};

export async function importMultiPeriodMetrics(
  input: MultiPeriodImportMetricsInput,
): Promise<MultiPeriodImportMetricsResult> {
  const { allianceId, groups } = input;

  if (!allianceId) {
    throw new Error("Alliance is required");
  }

  validateMultiPeriodImportGroups(groups);

  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  const targetPeriodIds = groups.map((g) => g.targetPeriodId);
  const periods = await prisma.metricPeriod.findMany({
    where: {
      id: { in: targetPeriodIds },
      allianceId,
      active: true,
    },
    select: { id: true, name: true },
  });

  if (periods.length !== targetPeriodIds.length) {
    throw new Error("One or more target periods were not found for this alliance");
  }

  const periodNameById = new Map(periods.map((p) => [p.id, p.name]));

  const [libraryMetrics, periodMetricsRows] = await Promise.all([
    prisma.metric.findMany({
      where: { allianceId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.metricPeriodMetric.findMany({
      where: {
        periodId: { in: targetPeriodIds },
        active: true,
      },
      select: { periodId: true, metricId: true },
    }),
  ]);

  const libraryMetricIds = new Set(libraryMetrics.map((m) => m.id));
  const periodMetricIdsByPeriod = new Map<string, Set<string>>();
  for (const row of periodMetricsRows) {
    if (!periodMetricIdsByPeriod.has(row.periodId)) {
      periodMetricIdsByPeriod.set(row.periodId, new Set());
    }
    periodMetricIdsByPeriod.get(row.periodId)!.add(row.metricId);
  }

  const groupPlans = groups.map((group) => {
    const periodMetricIds = [...(periodMetricIdsByPeriod.get(group.targetPeriodId) ?? new Set())];
    const attachedMetricIds = periodMetricIdsByPeriod.get(group.targetPeriodId) ?? new Set();

    const plan = planMultiPeriodImportGroup(group, {
      periodMetricIds,
      libraryMetrics,
    });

    for (const { target, sourceColumnName } of plan.validated) {
      if (
        target.kind === "existing" &&
        !libraryMetricIds.has(target.metricId) &&
        !attachedMetricIds.has(target.metricId)
      ) {
        throw new Error("One or more metrics do not belong to this alliance");
      }

      const colClassification = classifyColumn({
        columnIndex: 0,
        columnName: sourceColumnName,
        periodMetrics: libraryMetrics.filter((m) => attachedMetricIds.has(m.id)),
        libraryMetrics,
      });

      if (
        colClassification.reason === "matches_period_pattern" ||
        colClassification.reason === "ambiguous_name"
      ) {
        if (target.kind === "create") {
          if (!hasPermission(auth.permissions, Permissions.CONFIGURE_METRICS)) {
            throw new Error(
              `You do not have permission to create a metric for column '${sourceColumnName}'`,
            );
          }
        }
      }
    }

    return plan;
  });

  for (const permission of aggregateRequiredPermissions(groupPlans)) {
    if (!hasPermission(auth.permissions, permission)) {
      throw new Error(
        "You do not have permission to create or attach metrics during import",
      );
    }
  }

  const memberIds = [
    ...new Set(
      groupPlans.flatMap((plan) =>
        plan.validated.flatMap((m) => m.entries.map((e) => e.memberId)),
      ),
    ),
  ];

  const validMembers = await prisma.allianceMember.findMany({
    where: { id: { in: memberIds }, allianceId },
    select: { id: true },
  });
  const validMemberIds = new Set(validMembers.map((m) => m.id));
  if (memberIds.some((id) => !validMemberIds.has(id))) {
    throw new Error("One or more members do not belong to this alliance");
  }

  const transactionResults = await prisma.$transaction(async (tx) => {
    const results: Array<{
      periodId: string;
      plan: ReturnType<typeof buildMetricImportPlan>;
      resolved: Awaited<ReturnType<typeof resolveMetricTargets>>;
    }> = [];

    for (const groupPlan of groupPlans) {
      const resolved = await resolveMetricTargets(tx, {
        allianceId,
        periodId: groupPlan.targetPeriodId,
        classified: groupPlan.classified,
      });

      const finalMappings: MetricMapping[] = resolved.map((r, i) => ({
        metricId: r.metricId,
        entries: groupPlan.validated[i].entries,
      }));
      const plan = buildMetricImportPlan(finalMappings);

      for (const mapping of plan.mappings) {
        await tx.memberMetricEntry.createMany({
          data: mapping.entries.map((entry) => ({
            allianceMemberId: entry.memberId,
            periodId: groupPlan.targetPeriodId,
            metricId: mapping.metricId,
            value: entry.value,
          })),
        });
      }

      results.push({
        periodId: groupPlan.targetPeriodId,
        plan,
        resolved,
      });
    }

    return results;
  });

  for (const periodId of targetPeriodIds) {
    revalidateAllianceData({
      allianceId,
      periodId,
      domains: ["evaluation-results"],
    });
  }
  revalidateAllianceData({
    allianceId,
    domains: ["members", "dashboard", "setup"],
  });

  const allMetricIds = [
    ...new Set(
      transactionResults.flatMap((r) => r.resolved.map((item) => item.metricId)),
    ),
  ];
  const summaryMetrics = await prisma.metric.findMany({
    where: { id: { in: allMetricIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(summaryMetrics.map((m) => [m.id, m.name]));
  const nameFor = (metricId: string) => nameById.get(metricId) ?? "Metric";

  const dedupeSummaries = (metricIds: string[]): MetricSummary[] =>
    [...new Set(metricIds)].map((metricId) => ({
      metricId,
      name: nameFor(metricId),
    }));

  const periodsResult: MultiPeriodImportPeriodResult[] = transactionResults.map(
    ({ periodId, plan, resolved }) => ({
      periodId,
      periodName: periodNameById.get(periodId) ?? "Period",
      totalCount: plan.totalCount,
      perMetric: plan.mappings.map((m) => ({
        metricId: m.metricId,
        name: nameFor(m.metricId),
        count: m.entries.length,
      })),
      created: dedupeSummaries(resolved.filter((r) => r.created).map((r) => r.metricId)),
      attached: dedupeSummaries(resolved.filter((r) => r.attached).map((r) => r.metricId)),
      reused: dedupeSummaries(
        resolved.filter((r) => !r.created && !r.attached).map((r) => r.metricId),
      ),
    }),
  );

  return {
    success: true,
    periods: periodsResult,
    totalCount: periodsResult.reduce((sum, p) => sum + p.totalCount, 0),
  };
}
