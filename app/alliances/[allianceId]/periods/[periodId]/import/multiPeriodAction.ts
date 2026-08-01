"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions, hasPermission } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import {
  buildMetricImportPlan,
  assertImportMetricTargetBelongsToAlliance,
  type MetricMapping,
} from "@/app/src/lib/metricImport";
import { resolveMetricTargets } from "@/app/src/lib/metricResolution";
import { classifyColumn } from "@/app/src/lib/columnClassifier";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { validateMetricPeriodFields } from "@/app/src/lib/metricPeriodValidation";
import {
  aggregateRequiredPermissions,
  planMultiPeriodImportGroup,
  validateMultiPeriodImportGroups,
  type MultiPeriodImportGroupInput,
} from "@/app/src/lib/import/multiPeriodImport";
import { assertBooleanMetricValuesValid } from "@/app/src/lib/metrics/assertBooleanMetricValues";

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

  const existingPeriodIds = groups
    .filter((group) => group.target.kind === "existing")
    .map((group) => (group.target as { kind: "existing"; periodId: string }).periodId);

  const existingPeriods =
    existingPeriodIds.length > 0
      ? await prisma.metricPeriod.findMany({
          where: {
            id: { in: existingPeriodIds },
            allianceId,
            active: true,
          },
          select: { id: true, name: true },
        })
      : [];

  if (existingPeriods.length !== existingPeriodIds.length) {
    throw new Error("One or more target periods were not found for this alliance");
  }

  const periodNameById = new Map(existingPeriods.map((period) => [period.id, period.name]));

  const [libraryMetrics, periodMetricsRows] = await Promise.all([
    prisma.metric.findMany({
      where: { allianceId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    existingPeriodIds.length > 0
      ? prisma.metricPeriodMetric.findMany({
          where: {
            periodId: { in: existingPeriodIds },
            active: true,
          },
          select: { periodId: true, metricId: true },
        })
      : Promise.resolve([]),
  ]);

  const libraryMetricIds = new Set(libraryMetrics.map((metric) => metric.id));
  const periodMetricIdsByPeriod = new Map<string, Set<string>>();
  for (const row of periodMetricsRows) {
    if (!periodMetricIdsByPeriod.has(row.periodId)) {
      periodMetricIdsByPeriod.set(row.periodId, new Set());
    }
    periodMetricIdsByPeriod.get(row.periodId)!.add(row.metricId);
  }

  const groupPlans = groups.map((group) => {
    const periodMetricIds =
      group.target.kind === "existing"
        ? [...(periodMetricIdsByPeriod.get(group.target.periodId) ?? new Set())]
        : [];
    const attachedMetricIds =
      group.target.kind === "existing"
        ? (periodMetricIdsByPeriod.get(group.target.periodId) ?? new Set())
        : new Set<string>();

    const plan = planMultiPeriodImportGroup(group, {
      periodMetricIds,
      libraryMetrics,
    });

    for (const { target, sourceColumnName } of plan.validated) {
      assertImportMetricTargetBelongsToAlliance(
        target,
        libraryMetricIds,
        attachedMetricIds,
      );

      const colClassification = classifyColumn({
        columnIndex: 0,
        columnName: sourceColumnName,
        periodMetrics: libraryMetrics.filter((metric) => attachedMetricIds.has(metric.id)),
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

  for (const permission of aggregateRequiredPermissions(groupPlans, groups)) {
    if (!hasPermission(auth.permissions, permission)) {
      throw new Error(
        "You do not have permission to create or attach metrics during import",
      );
    }
  }

  const memberIds = [
    ...new Set(
      groupPlans.flatMap((plan) =>
        plan.validated.flatMap((mapping) => mapping.entries.map((entry) => entry.memberId)),
      ),
    ),
  ];

  const validMembers = await prisma.allianceMember.findMany({
    where: { id: { in: memberIds }, allianceId },
    select: { id: true },
  });
  const validMemberIds = new Set(validMembers.map((member) => member.id));
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
      let periodId: string;

      if (groupPlan.target.kind === "create") {
        const validated = validateMetricPeriodFields(groupPlan.target);
        const created = await tx.metricPeriod.create({
          data: {
            allianceId,
            name: validated.name,
            startsAt: validated.startsAt,
            endsAt: validated.endsAt,
            active: true,
          },
        });
        periodId = created.id;
        periodNameById.set(periodId, created.name);
      } else {
        periodId = groupPlan.target.periodId;
      }

      const resolved = await resolveMetricTargets(tx, {
        allianceId,
        periodId,
        classified: groupPlan.classified,
      });

      const finalMappings: MetricMapping[] = resolved.map((resolvedTarget, index) => ({
        metricId: resolvedTarget.metricId,
        entries: groupPlan.validated[index].entries,
      }));
      const plan = buildMetricImportPlan(finalMappings);

      // Re-check authoritative metric types after resolution and reject any
      // BOOLEAN-mapped value outside {0, 1} before writing anything (#190).
      await assertBooleanMetricValuesValid(tx, plan.mappings);

      for (const mapping of plan.mappings) {
        await tx.memberMetricEntry.createMany({
          data: mapping.entries.map((entry) => ({
            allianceMemberId: entry.memberId,
            periodId,
            metricId: mapping.metricId,
            value: entry.value,
          })),
        });
      }

      results.push({
        periodId,
        plan,
        resolved,
      });
    }

    await touchAllianceSetupActivity(tx, allianceId);

    return results;
  });

  const committedPeriodIds = [...new Set(transactionResults.map((result) => result.periodId))];
  for (const periodId of committedPeriodIds) {
    revalidateAllianceData({
      allianceId,
      periodId,
      domains: ["evaluation-results"],
    });
  }
  revalidateAllianceData({
    allianceId,
    domains: ["members", "dashboard", "setup", "reports"],
  });

  const allMetricIds = [
    ...new Set(
      transactionResults.flatMap((result) => result.resolved.map((item) => item.metricId)),
    ),
  ];
  const summaryMetrics = await prisma.metric.findMany({
    where: { id: { in: allMetricIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(summaryMetrics.map((metric) => [metric.id, metric.name]));
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
      perMetric: plan.mappings.map((mapping) => ({
        metricId: mapping.metricId,
        name: nameFor(mapping.metricId),
        count: mapping.entries.length,
      })),
      created: dedupeSummaries(resolved.filter((item) => item.created).map((item) => item.metricId)),
      attached: dedupeSummaries(resolved.filter((item) => item.attached).map((item) => item.metricId)),
      reused: dedupeSummaries(
        resolved.filter((item) => !item.created && !item.attached).map((item) => item.metricId),
      ),
    }),
  );

  return {
    success: true,
    periods: periodsResult,
    totalCount: periodsResult.reduce((sum, period) => sum + period.totalCount, 0),
  };
}
