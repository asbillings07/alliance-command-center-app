"use server";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
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

  const required = formData.get("required") === "on";

  return { periodId, metricId, weight, required };
};

export async function addMetricToPeriod(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const { periodId, metricId, weight, required } = validateFormData(formData);

  const { period } = await requirePeriodAccess(periodId, user.id);

  await prisma.metricPeriodMetric.create({
    data: {
      periodId,
      metricId,
      weight,
      required,
    },
  });

  revalidatePath(`/alliances/${period.allianceId}/periods/${periodId}`);
}

export async function editPeriodMetric(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const { periodId, metricId, weight, required } = validateFormData(formData);

  const { period } = await requirePeriodAccess(periodId, user.id);

  await prisma.metricPeriodMetric.update({
    where: { periodId_metricId: { periodId, metricId } },
    data: { weight, required },
  });

  revalidatePath(`/alliances/${period.allianceId}/periods/${periodId}`);
}
