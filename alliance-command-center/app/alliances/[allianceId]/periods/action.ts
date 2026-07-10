"use server";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";

function validateCreateFormData(formData: FormData) {
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

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  return { name, startsAt, endsAt, allianceId };
}

function validateEditFormData(formData: FormData) {
  const base = validateCreateFormData(formData);

  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  return { ...base, periodId };
}

function validatePeriodIdFormData(formData: FormData) {
  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  return { periodId };
}

export async function createMetricPeriod(formData: FormData): Promise<void> {
  const { name, startsAt, endsAt, allianceId } = validateCreateFormData(formData);

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  await prisma.metricPeriod.create({
    data: {
      allianceId,
      name: name.trim(),
      startsAt,
      endsAt,
    },
  });

  revalidatePath(`/alliances/${allianceId}/periods`);
}

export async function editMetricPeriod(formData: FormData): Promise<void> {
  const { name, startsAt, endsAt, allianceId, periodId } =
    validateEditFormData(formData);

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

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: {
      name: name.trim(),
      startsAt,
      endsAt,
    },
  });

  revalidatePath(`/alliances/${allianceId}/periods`);
}

export async function archiveMetricPeriod(formData: FormData): Promise<void> {
  const { periodId } = validatePeriodIdFormData(formData);

  // Load period to get alliance ID
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  await requireAllianceAccess({
    allianceId: period.allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: { active: false },
  });

  revalidatePath(`/alliances/${period.allianceId}/periods`);
}

export async function restoreMetricPeriod(formData: FormData): Promise<void> {
  const { periodId } = validatePeriodIdFormData(formData);

  // Load period to get alliance ID
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  await requireAllianceAccess({
    allianceId: period.allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: { active: true },
  });

  revalidatePath(`/alliances/${period.allianceId}/periods`);
}
