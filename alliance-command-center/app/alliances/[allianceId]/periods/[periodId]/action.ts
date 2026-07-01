"use server";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";

export async function addMetricToPeriod(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  const { period } = await requirePeriodAccess(periodId, user.id);

  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const weight = parseInt(formData.get("weight") as string);
  if (isNaN(weight) || weight < 0 || weight > 100) {
    throw new Error("Weight is invalid");
  }

  const required = Boolean(formData.get("required"));

  await prisma.metricPeriodMetric.upsert({
    where: { periodId_metricId: { periodId, metricId } },
    update: { weight, required },
    create: {
      periodId,
      metricId,
      weight,
      required: required || false,
    },
  });

  revalidatePath(`/alliances/${period.allianceId}/periods/${periodId}`);
}
