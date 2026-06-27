"use server";
import { Metric_Type } from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { revalidatePath } from "next/cache";

export async function createMetric(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  await requireLeadershipAccess(allianceId, user.id);

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
  const user = await requireAuth();

  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const metric = await prisma.metric.findUnique({
    where: { id: metricId },
  });

  if (!metric) {
    throw new Error("Metric not found");
  }

  await requireLeadershipAccess(metric.allianceId, user.id);

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

  revalidatePath(`/alliances/${metric.allianceId}/metrics`);
}

export async function archiveMetric(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const metric = await prisma.metric.findUnique({
    where: { id: metricId },
  });

  if (!metric) {
    throw new Error("Metric not found");
  }

  await requireLeadershipAccess(metric.allianceId, user.id);

  await prisma.metric.update({
    where: { id: metricId },
    data: { active: false },
  });

  revalidatePath(`/alliances/${metric.allianceId}/metrics`);
}

export async function restoreMetric(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const metricId = formData.get("metricId");
  if (typeof metricId !== "string" || !metricId) {
    throw new Error("Metric is required");
  }

  const metric = await prisma.metric.findUnique({
    where: { id: metricId },
  });

  if (!metric) {
    throw new Error("Metric not found");
  }

  await requireLeadershipAccess(metric.allianceId, user.id);

  await prisma.metric.update({
    where: { id: metricId },
    data: { active: true },
  });

  revalidatePath(`/alliances/${metric.allianceId}/metrics`);
}
