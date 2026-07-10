"use server";
import { Metric_Type } from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export type MetricActionResult = {
  error?: string;
  success?: boolean;
};

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

  try {
    await prisma.metric.create({
      data: {
        allianceId,
        name: name.trim(),
        description,
        type,
      },
    });
  } catch (err) {
    console.error("Failed to create metric:", err);
    return { error: "Failed to create metric" };
  }

  revalidatePath(`/alliances/${allianceId}/metrics`);
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

  const type = formData.get("type") as Metric_Type;
  if (!Object.values(Metric_Type).includes(type)) {
    return { error: "Invalid metric type" };
  }

  try {
    await prisma.metric.update({
      where: { id: metricId },
      data: {
        name: name.trim(),
        description,
        type,
      },
    });
  } catch (err) {
    console.error("Failed to update metric:", err);
    return { error: "Failed to update metric" };
  }

  revalidatePath(`/alliances/${allianceId}/metrics`);
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
    await prisma.metric.update({
      where: { id: metricId },
      data: { active: false },
    });
  } catch (err) {
    console.error("Failed to archive metric:", err);
    return { error: "Failed to archive metric" };
  }

  revalidatePath(`/alliances/${allianceId}/metrics`);
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
    await prisma.metric.update({
      where: { id: metricId },
      data: { active: true },
    });
  } catch (err) {
    console.error("Failed to restore metric:", err);
    return { error: "Failed to restore metric" };
  }

  revalidatePath(`/alliances/${allianceId}/metrics`);
  return { success: true };
}
