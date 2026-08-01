"use server";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import {
  isValidSummaryKindForType,
  describeSummaryKindMismatch,
  validateUnitLabel,
} from "@/app/src/lib/metrics/metricSummaryKind";
import { revalidatePath } from "next/cache";

export type MetricActionResult = {
  error?: string;
  success?: boolean;
};

function revalidateReportRoutes(allianceId: string): void {
  revalidatePath(`/alliances/${allianceId}/reports`);
  revalidatePath("/alliances/[allianceId]/reports/metrics/[metricId]", "page");
}

type ReportingFields = { summaryKind: MetricSummaryKind; unitLabel: string | null };

/**
 * Reads and validates the "Reporting" section of the metric form: the
 * summaryKind enum value and the optional unitLabel, rejecting any
 * (type, summaryKind) combination outside the compatibility matrix. This is
 * a fast, friendly pre-check; the migration's DB CHECK constraint is the
 * actual invariant (#190).
 */
function parseReportingFields(
  formData: FormData,
  type: Metric_Type,
): { data: ReportingFields } | { error: string } {
  const rawSummaryKind = formData.get("summaryKind");
  const summaryKind = (
    typeof rawSummaryKind === "string" && rawSummaryKind ? rawSummaryKind : MetricSummaryKind.NONE
  ) as MetricSummaryKind;
  if (!Object.values(MetricSummaryKind).includes(summaryKind)) {
    return { error: "Invalid summary kind" };
  }
  if (!isValidSummaryKindForType(type, summaryKind)) {
    return { error: describeSummaryKindMismatch(type, summaryKind) };
  }

  const unitLabelValidation = validateUnitLabel(formData.get("unitLabel") as string | null);
  if (!unitLabelValidation.ok) {
    return { error: unitLabelValidation.message };
  }

  return { data: { summaryKind, unitLabel: unitLabelValidation.value } };
}

async function revalidateMetricStateChange(
  allianceId: string,
  metricId: string,
): Promise<void> {
  const attachments = await prisma.metricPeriodMetric.findMany({
    where: { metricId, period: { allianceId } },
    select: { periodId: true },
  });

  revalidateAllianceData({
    allianceId,
    domains: ["setup", "dashboard", "reports"],
  });
  revalidatePath(`/alliances/${allianceId}/metrics`);
  revalidatePath(`/alliances/${allianceId}/periods`);

  for (const { periodId } of attachments) {
    revalidateAllianceData({
      allianceId,
      periodId,
      domains: ["evaluation-results"],
    });
  }
}

export async function createMetric(
  formData: FormData
): Promise<MetricActionResult> {
  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_METRICS,
  });

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    return { error: "Name is required" };
  }

  const rawDescription = formData.get("description");
  const description =
    typeof rawDescription === "string" ? rawDescription.trim() || null : null;

  const type = formData.get("type") as Metric_Type;
  if (!Object.values(Metric_Type).includes(type)) {
    return { error: "Invalid metric type" };
  }

  const reporting = parseReportingFields(formData, type);
  if ("error" in reporting) {
    return { error: reporting.error };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metric.create({
        data: {
          allianceId,
          name: name.trim(),
          description,
          type,
          summaryKind: reporting.data.summaryKind,
          unitLabel: reporting.data.unitLabel,
        },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to create metric:", err);
    return { error: "Failed to create metric" };
  }

  revalidatePath(`/alliances/${allianceId}/metrics`);
  revalidateReportRoutes(allianceId);
  return { success: true };
}

export async function editMetric(
  formData: FormData
): Promise<MetricActionResult> {
  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    return { error: "Metric is required" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  // Authorize before any DB lookup to prevent ID enumeration
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_METRICS,
  });

  // Query scoped by both id and allianceId for safety
  const metric = await prisma.metric.findFirst({
    where: { id: metricId, allianceId },
  });

  if (!metric) {
    return { error: "Metric not found" };
  }

  if (!metric.active) {
    return {
      error: "Metric is archived and cannot be edited. Please restore it first.",
    };
  }

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    return { error: "Name is required" };
  }

  const rawDescription = formData.get("description");
  const description =
    typeof rawDescription === "string" ? rawDescription.trim() || null : null;

  // #190: type is immutable after creation. A metric's historical entries
  // are only meaningful under the type they were recorded with, and a
  // count-then-write check for "any entries yet?" would still race a
  // concurrent result write. The submitted `type` field (disabled in the
  // edit form) is always ignored in favor of the metric's existing type.
  const type = metric.type;

  const reporting = parseReportingFields(formData, type);
  if ("error" in reporting) {
    return { error: reporting.error };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metric.update({
        where: { id: metricId },
        data: {
          name: name.trim(),
          description,
          summaryKind: reporting.data.summaryKind,
          unitLabel: reporting.data.unitLabel,
        },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to update metric:", err);
    return { error: "Failed to update metric" };
  }

  revalidatePath(`/alliances/${allianceId}/metrics`);
  revalidateReportRoutes(allianceId);
  return { success: true };
}

export async function archiveMetric(
  formData: FormData
): Promise<MetricActionResult> {
  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    return { error: "Metric is required" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  // Authorize before any DB lookup to prevent ID enumeration
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_METRICS,
  });

  // Query scoped by both id and allianceId for safety
  const metric = await prisma.metric.findFirst({
    where: { id: metricId, allianceId },
  });

  if (!metric) {
    return { error: "Metric not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metric.update({
        where: { id: metricId },
        data: { active: false },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to archive metric:", err);
    return { error: "Failed to archive metric" };
  }

  await revalidateMetricStateChange(allianceId, metricId);
  return { success: true };
}

export async function restoreMetric(
  formData: FormData
): Promise<MetricActionResult> {
  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    return { error: "Metric is required" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  // Authorize before any DB lookup to prevent ID enumeration
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_METRICS,
  });

  // Query scoped by both id and allianceId for safety
  const metric = await prisma.metric.findFirst({
    where: { id: metricId, allianceId },
  });

  if (!metric) {
    return { error: "Metric not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metric.update({
        where: { id: metricId },
        data: { active: true },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to restore metric:", err);
    return { error: "Failed to restore metric" };
  }

  await revalidateMetricStateChange(allianceId, metricId);
  return { success: true };
}
