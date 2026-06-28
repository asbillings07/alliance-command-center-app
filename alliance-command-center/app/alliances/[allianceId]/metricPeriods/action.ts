"use server";
import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { revalidatePath } from "next/cache";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";

const validateFormData = (formData: FormData) => {
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Name is required");
  }

  const rawStartsAt = formData.get("startsAt");
  const startsAt =
    typeof rawStartsAt === "string" && rawStartsAt
      ? new Date(rawStartsAt)
      : null;

  const rawEndsAt = formData.get("endsAt");
  const endsAt =
    typeof rawEndsAt === "string" && rawEndsAt ? new Date(rawEndsAt) : null;

  return { name, startsAt, endsAt };
};

export async function createMetricPeriod(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  await requireLeadershipAccess(allianceId, user.id);

  const { name, startsAt, endsAt } = validateFormData(formData);

  await prisma.metricPeriod.create({
    data: {
      allianceId,
      name: name.trim(),
      startsAt,
      endsAt,
    },
  });

  revalidatePath(`/alliances/${allianceId}/metricPeriods`);
}

export async function editMetricPeriod(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  await requireLeadershipAccess(period.allianceId, user.id);

  const { name, startsAt, endsAt } = validateFormData(formData);

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: {
      name: name.trim(),
      startsAt,
      endsAt,
    },
  });

  revalidatePath(`/alliances/${period.allianceId}/metricPeriods`);
}

export async function archiveMetricPeriod(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  const { period } = await requirePeriodAccess(periodId, user.id);

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: { active: false },
  });

  revalidatePath(`/alliances/${period.allianceId}/metricPeriods`);
}

export async function restoreMetricPeriod(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  const { period } = await requirePeriodAccess(periodId, user.id);

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: { active: true },
  });

  revalidatePath(`/alliances/${period.allianceId}/metricPeriods`);
}
