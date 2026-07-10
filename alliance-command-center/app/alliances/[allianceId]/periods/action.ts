"use server";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export type PeriodActionResult = {
  error?: string;
  success?: boolean;
};

type CreateFormData = {
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  allianceId: string;
};

type EditFormData = CreateFormData & { periodId: string };

function validateCreateFormData(
  formData: FormData
): { data: CreateFormData } | { error: string } {
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    return { error: "Name is required" };
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
    return { error: "Alliance is required" };
  }

  return { data: { name, startsAt, endsAt, allianceId } };
}

function validateEditFormData(
  formData: FormData
): { data: EditFormData } | { error: string } {
  const baseResult = validateCreateFormData(formData);
  if ("error" in baseResult) {
    return baseResult;
  }

  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    return { error: "Period is required" };
  }

  return { data: { ...baseResult.data, periodId } };
}

function validateArchiveRestoreFormData(formData: FormData) {
  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    throw new Error("Period is required");
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  return { periodId, allianceId };
}

export async function createMetricPeriod(
  formData: FormData
): Promise<PeriodActionResult> {
  const validated = validateCreateFormData(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const { name, startsAt, endsAt, allianceId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  try {
    await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: name.trim(),
        startsAt,
        endsAt,
      },
    });
  } catch (err) {
    console.error("Failed to create period:", err);
    return { error: "Failed to create period" };
  }

  revalidatePath(`/alliances/${allianceId}/periods`);
  return { success: true };
}

export async function editMetricPeriod(
  formData: FormData
): Promise<PeriodActionResult> {
  const validated = validateEditFormData(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const { name, startsAt, endsAt, allianceId, periodId } = validated.data;

  // Authorize before any DB lookup
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

  try {
    await prisma.metricPeriod.update({
      where: { id: periodId },
      data: {
        name: name.trim(),
        startsAt,
        endsAt,
      },
    });
  } catch (err) {
    console.error("Failed to update period:", err);
    return { error: "Failed to update period" };
  }

  revalidatePath(`/alliances/${allianceId}/periods`);
  return { success: true };
}

export async function archiveMetricPeriod(formData: FormData): Promise<void> {
  const { periodId, allianceId } = validateArchiveRestoreFormData(formData);

  // Authorize before any DB lookup to prevent ID enumeration
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: { active: false },
  });

  revalidatePath(`/alliances/${allianceId}/periods`);
}

export async function restoreMetricPeriod(formData: FormData): Promise<void> {
  const { periodId, allianceId } = validateArchiveRestoreFormData(formData);

  // Authorize before any DB lookup to prevent ID enumeration
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  await prisma.metricPeriod.update({
    where: { id: periodId },
    data: { active: true },
  });

  revalidatePath(`/alliances/${allianceId}/periods`);
}
