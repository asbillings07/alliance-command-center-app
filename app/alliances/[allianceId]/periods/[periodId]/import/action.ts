"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { buildMetricImportPlan, type MetricMapping } from "@/app/src/lib/metricImport";
import { revalidatePath } from "next/cache";

type ImportMetricsInput = {
  periodId: string;
  allianceId: string;
  mappings: MetricMapping[];
};

type ImportMetricsResult = {
  success: boolean;
  totalCount: number;
  perMetric: { metricId: string; count: number }[];
};

export async function importMemberMetrics(
  input: ImportMetricsInput,
): Promise<ImportMetricsResult> {
  const { periodId, allianceId, mappings } = input;

  if (!periodId || !allianceId) {
    throw new Error("Period and alliance are required");
  }

  // Validate + normalize (integer values, per-metric dedupe, no duplicate
  // metric columns) before any DB work. Throws on the first violation.
  const plan = buildMetricImportPlan(mappings);

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  // Query scoped by both id and allianceId for safety.
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  // Every mapped metric must be configured for this period.
  const periodMetrics = await prisma.metricPeriodMetric.findMany({
    where: { periodId: period.id, metricId: { in: plan.metricIds } },
    select: { metricId: true },
  });
  const configuredMetricIds = new Set(periodMetrics.map((m) => m.metricId));
  const unconfigured = plan.metricIds.filter(
    (id) => !configuredMetricIds.has(id),
  );
  if (unconfigured.length > 0) {
    // Name the offending metrics so the user can fix the mapping without
    // guessing which column is at fault.
    const names = await prisma.metric.findMany({
      where: { id: { in: unconfigured } },
      select: { name: true },
    });
    const label =
      names.length > 0
        ? names.map((m) => m.name).join(", ")
        : unconfigured.join(", ");
    throw new Error(
      `These metrics are not configured for this period: ${label}`,
    );
  }

  // Every referenced member must belong to this alliance.
  const validMembers = await prisma.allianceMember.findMany({
    where: { id: { in: plan.memberIds }, allianceId },
    select: { id: true },
  });
  const validMemberIds = new Set(validMembers.map((m) => m.id));
  const invalidMemberIds = plan.memberIds.filter(
    (id) => !validMemberIds.has(id),
  );
  if (invalidMemberIds.length > 0) {
    throw new Error("One or more members do not belong to this alliance");
  }

  // All-or-nothing: the user is importing one report, not N independent
  // datasets, so a failure on any metric must not leave a partial import.
  await prisma.$transaction(
    plan.mappings.map((mapping) =>
      prisma.memberMetricEntry.createMany({
        data: mapping.entries.map((entry) => ({
          allianceMemberId: entry.memberId,
          periodId,
          metricId: mapping.metricId,
          value: entry.value,
        })),
      }),
    ),
  );

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);

  return {
    success: true,
    totalCount: plan.totalCount,
    perMetric: plan.mappings.map((m) => ({
      metricId: m.metricId,
      count: m.entries.length,
    })),
  };
}
