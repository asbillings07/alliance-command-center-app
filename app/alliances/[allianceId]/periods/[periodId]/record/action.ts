"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { Metric_Type } from "@/app/generated/prisma/enums";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";
import { revalidatePath } from "next/cache";

type RecordMemberMetricsInput = {
  periodId: string;
  metricId: string;
  allianceId: string;
  entries: {
    memberId: string;
    value: number;
  }[];
};

export async function recordMemberMetrics(
  input: RecordMemberMetricsInput,
): Promise<void> {
  const { periodId, metricId, allianceId, entries } = input;

  if (!periodId || !metricId || !allianceId) {
    throw new Error("Period, metric, and alliance are required");
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("At least one entry is required");
  }

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  // Validate metric is configured for this period, and load the authoritative
  // metric type so BOOLEAN metrics can be validated below.
  const periodMetric = await prisma.metricPeriodMetric.findUnique({
    where: {
      periodId_metricId: { periodId, metricId },
    },
    include: { metric: { select: { type: true } } },
  });

  if (!periodMetric) {
    throw new Error("Metric is not configured for this period");
  }

  // Validate all entries have integer values; BOOLEAN metrics additionally
  // require exactly 0 or 1 (#190) so the value can never be misinterpreted as
  // a true/false rate downstream.
  for (const entry of entries) {
    if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
      throw new Error("All values must be integers");
    }
    if (
      periodMetric.metric.type === Metric_Type.BOOLEAN &&
      !isValidBooleanMetricValue(entry.value)
    ) {
      throw new Error("Boolean metric values must be exactly 0 or 1");
    }
    if (typeof entry.memberId !== "string" || !entry.memberId) {
      throw new Error("Invalid member ID");
    }
  }

  // Validate all allianceMemberIds belong to this alliance
  const allianceMemberIds = entries.map((e) => e.memberId);
  const validAllianceMembers = await prisma.allianceMember.findMany({
    where: {
      id: { in: allianceMemberIds },
      allianceId: allianceId,
    },
    select: { id: true },
  });

  const validAllianceMemberIds = new Set(validAllianceMembers.map((m) => m.id));
  const invalidAllianceMemberIds = allianceMemberIds.filter((id) => !validAllianceMemberIds.has(id));

  if (invalidAllianceMemberIds.length > 0) {
    throw new Error("One or more members do not belong to this alliance");
  }

  await prisma.$transaction(async (tx) => {
    await tx.memberMetricEntry.createMany({
      data: entries.map((entry) => ({
        allianceMemberId: entry.memberId,
        periodId,
        metricId,
        value: entry.value,
      })),
    });
    await touchAllianceSetupActivity(tx, allianceId);
  });

  revalidatePath(`/alliances/${period.allianceId}/periods/${period.id}/record`);
  revalidateAllianceData({
    allianceId,
    periodId,
    // "setup" matches the touchAllianceSetupActivity call above — without it
    // the setup checklist can show a stale setupActivityAt after recording.
    domains: ["setup", "evaluation-results", "reports"],
  });
}
