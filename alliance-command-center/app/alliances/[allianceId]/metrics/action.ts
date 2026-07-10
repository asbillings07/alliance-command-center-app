"use server";
import { Metric_Type } from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export async function createMetric(formData: FormData): Promise<void> {
  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.CONFIGURE_METRICS,
  });

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Name is required");
  }

  const rawDescription = formData.get("description");
  const description =
    typeof rawDescription === "string" ? rawDescription.trim() || null : null;

  const type = formData.get("type") as Metric_Type;
  if (!Object.values(Metric_Type).includes(type)) {
    throw new Error("Invalid metric type");
  }

  await prisma.metric.create({
    data: {
      allianceId,
      name: name.trim(),
      description,
      type,
    },
  });

  revalidatePath(`/alliances/${allianceId}/metrics`);
}

export async function editMetric(formData: FormData): Promise<void> {
  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
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
    throw new Error("Metric not found");
  }

  if (!metric.active) {
    throw new Error(
      "Metric is archived and cannot be edited, please restore it to edit it.",
    );
  }

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Name is required");
  }

  const rawDescription = formData.get("description");
  const description =
    typeof rawDescription === "string" ? rawDescription.trim() || null : null;

  const type = formData.get("type") as Metric_Type;
  if (!Object.values(Metric_Type).includes(type)) {
    throw new Error("Invalid metric type");
  }

  await prisma.metric.update({
    where: { id: metricId },
    data: {
      name: name.trim(),
      description,
      type,
    },
  });

  revalidatePath(`/alliances/${allianceId}/metrics`);
}

export async function archiveMetric(formData: FormData): Promise<void> {
  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
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
    throw new Error("Metric not found");
  }

  await prisma.metric.update({
    where: { id: metricId },
    data: { active: false },
  });

  revalidatePath(`/alliances/${allianceId}/metrics`);
}

export async function restoreMetric(formData: FormData): Promise<void> {
  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
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
    throw new Error("Metric not found");
  }

  await prisma.metric.update({
    where: { id: metricId },
    data: { active: true },
  });

  revalidatePath(`/alliances/${allianceId}/metrics`);
}
