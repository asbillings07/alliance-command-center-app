"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";

const validateFormData = (formData: FormData) => {
  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const weight = parseInt(formData.get("weight") as string);
  if (isNaN(weight) || weight < 0 || weight > 100) {
    throw new Error("Weight is invalid");
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  const required = formData.get("required") === "on";

  return { periodId, metricId, weight, required, allianceId };
};

export async function addMetricToPeriod(formData: FormData): Promise<void> {
  const { periodId, metricId, weight, required, allianceId } =
    validateFormData(formData);

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  // Verify period belongs to this alliance
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.allianceId !== allianceId) {
    throw new Error("Period not found");
  }

  await prisma.metricPeriodMetric.create({
    data: {
      periodId,
      metricId,
      weight,
      required,
    },
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}`);
}

export async function editPeriodMetric(formData: FormData): Promise<void> {
  const { periodId, metricId, weight, required, allianceId } =
    validateFormData(formData);

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  // Verify period belongs to this alliance
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.allianceId !== allianceId) {
    throw new Error("Period not found");
  }

  await prisma.metricPeriodMetric.update({
    where: { periodId_metricId: { periodId, metricId } },
    data: { weight, required },
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}`);
}
