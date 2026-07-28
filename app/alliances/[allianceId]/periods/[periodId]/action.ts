"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { prisma } from "@/app/src/lib/prisma";

export type PeriodMetricActionResult = {
  error?: string;
  success?: boolean;
};

type ValidatedFormData = {
  periodId: string;
  metricId: string;
  weight: number;
  required: boolean;
  allianceId: string;
};

function validateFormData(
  formData: FormData
): { data: ValidatedFormData } | { error: string } {
  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    return { error: "Period is required" };
  }

  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    return { error: "Metric is required" };
  }

  const weight = parseInt(formData.get("weight") as string);
  if (isNaN(weight) || weight < 0 || weight > 100) {
    return { error: "Weight must be between 0 and 100" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  const required = formData.get("required") === "on";

  return { data: { periodId, metricId, weight, required, allianceId } };
}

export async function addMetricToPeriod(
  formData: FormData
): Promise<PeriodMetricActionResult> {
  const validated = validateFormData(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const { periodId, metricId, weight, required, allianceId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    return { error: "Period not found" };
  }

  const metric = await prisma.metric.findFirst({
    where: { id: metricId, allianceId, active: true },
  });

  if (!metric) {
    return { error: "Metric not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metricPeriodMetric.create({
        data: {
          periodId,
          metricId,
          weight,
          required,
        },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to add metric to period:", err);
    return { error: "Failed to add metric. It may already be in this period." };
  }

  revalidateAllianceData({
    allianceId,
    periodId,
    domains: ["evaluation-results", "setup", "dashboard"],
  });
  return { success: true };
}

export async function editPeriodMetric(
  formData: FormData
): Promise<PeriodMetricActionResult> {
  const validated = validateFormData(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const { periodId, metricId, weight, required, allianceId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    return { error: "Period not found" };
  }

  const metric = await prisma.metric.findFirst({
    where: { id: metricId, allianceId, active: true },
  });

  if (!metric) {
    return { error: "Metric not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metricPeriodMetric.update({
        where: { periodId_metricId: { periodId, metricId } },
        data: { weight, required },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to update period metric:", err);
    return { error: "Failed to update metric" };
  }

  revalidateAllianceData({
    allianceId,
    periodId,
    domains: ["evaluation-results", "setup", "dashboard"],
  });
  return { success: true };
}
