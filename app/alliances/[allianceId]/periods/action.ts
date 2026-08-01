"use server";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { validateMetricPeriodFields } from "@/app/src/lib/metricPeriodValidation";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidatePath } from "next/cache";

export type CreatePeriodResult =
  | { success: true; periodId: string }
  | { success: false; error: string };

export type EditPeriodResult =
  | { success: true }
  | { success: false; error: string };

type CreateFormData = {
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  allianceId: string;
};

type EditFormData = CreateFormData & { periodId: string };

function parseOptionalDateField(value: FormDataEntryValue | null): string | null {
  if (typeof value === "string" && value) {
    return value;
  }
  return null;
}

function validateCreateFormData(
  formData: FormData,
): { data: CreateFormData } | { error: string } {
  const name = formData.get("name");
  const startsAt = parseOptionalDateField(formData.get("startsAt"));
  const endsAt = parseOptionalDateField(formData.get("endsAt"));

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  try {
    const validated = validateMetricPeriodFields({
      name: typeof name === "string" ? name : "",
      startsAt,
      endsAt,
    });
    return { data: { ...validated, allianceId } };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid period fields",
    };
  }
}

function validateEditFormData(
  formData: FormData,
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

function validateArchiveRestoreFormData(formData: FormData):
  | { data: { periodId: string; allianceId: string } }
  | { error: string } {
  const periodId = formData.get("periodId");
  if (typeof periodId !== "string" || !periodId) {
    return { error: "Period is required" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  return { data: { periodId, allianceId } };
}

function revalidatePeriodPaths(allianceId: string): void {
  revalidatePath(`/alliances/${allianceId}/periods`);
  revalidatePath(`/alliances/${allianceId}/setup`);
  revalidatePath(`/alliances/${allianceId}/setup/import`);
  revalidatePath(`/alliances/${allianceId}`);
  // #190: period create/edit/archive/restore all change comparison eligibility
  // and/or the default period a metric's report resolves to.
  revalidatePath(`/alliances/${allianceId}/reports`);
  revalidatePath("/alliances/[allianceId]/reports/metrics/[metricId]", "page");
}

export async function createMetricPeriod(
  formData: FormData,
): Promise<CreatePeriodResult> {
  const validated = validateCreateFormData(formData);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const { name, startsAt, endsAt, allianceId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  try {
    const period = await prisma.$transaction(async (tx) => {
      const created = await tx.metricPeriod.create({
        data: {
          allianceId,
          name,
          startsAt,
          endsAt,
        },
      });
      await touchAllianceSetupActivity(tx, allianceId);
      return created;
    });

    revalidatePeriodPaths(allianceId);
    return { success: true, periodId: period.id };
  } catch (err) {
    console.error("Failed to create period:", err);
    return { success: false, error: "Failed to create period" };
  }
}

export async function editMetricPeriod(
  formData: FormData,
): Promise<EditPeriodResult> {
  const validated = validateEditFormData(formData);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const { name, startsAt, endsAt, allianceId, periodId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    return { success: false, error: "Period not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metricPeriod.update({
        where: { id: periodId },
        data: {
          name,
          startsAt,
          endsAt,
        },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to update period:", err);
    return { success: false, error: "Failed to update period" };
  }

  revalidatePeriodPaths(allianceId);
  return { success: true };
}

export async function archiveMetricPeriod(
  formData: FormData,
): Promise<EditPeriodResult> {
  const validated = validateArchiveRestoreFormData(formData);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const { periodId, allianceId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    return { success: false, error: "Period not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metricPeriod.update({
        where: { id: periodId },
        data: { active: false },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to archive period:", err);
    return { success: false, error: "Failed to archive period" };
  }

  revalidatePeriodPaths(allianceId);
  return { success: true };
}

export async function restoreMetricPeriod(
  formData: FormData,
): Promise<EditPeriodResult> {
  const validated = validateArchiveRestoreFormData(formData);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const { periodId, allianceId } = validated.data;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_PERIODS,
  });

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    return { success: false, error: "Period not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metricPeriod.update({
        where: { id: periodId },
        data: { active: true },
      });
      await touchAllianceSetupActivity(tx, allianceId);
    });
  } catch (err) {
    console.error("Failed to restore period:", err);
    return { success: false, error: "Failed to restore period" };
  }

  revalidatePeriodPaths(allianceId);
  return { success: true };
}
