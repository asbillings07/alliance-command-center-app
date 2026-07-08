"use server";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";

type ImportEntry = {
  memberId: string;
  value: number;
};

type ImportMetricsInput = {
  periodId: string;
  metricId: string;
  allianceId: string;
  entries: ImportEntry[];
};

type CreateMetricAndImportInput = {
  periodId: string;
  allianceId: string;
  metricName: string;
  entries: ImportEntry[];
};

export async function createMetricAndImport(
  input: CreateMetricAndImportInput
): Promise<{ success: boolean; count: number; metricId: string; metricName: string }> {
  const user = await requireAuth();
  const { periodId, allianceId, metricName, entries } = input;

  if (!periodId || !allianceId || !metricName) {
    throw new Error("Period, alliance, and metric name are required");
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("At least one entry is required");
  }

  await requireLeadershipAccess(allianceId, user.id);

  // Validate period exists and belongs to alliance
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.allianceId !== allianceId) {
    throw new Error("Period not found");
  }

  // Create the metric
  const metric = await prisma.metric.create({
    data: {
      name: metricName.trim(),
      allianceId,
      type: "NUMERIC",
    },
  });

  // Add metric to the period
  await prisma.metricPeriodMetric.create({
    data: {
      periodId,
      metricId: metric.id,
      weight: 1,
      required: false,
    },
  });

  // Validate all entries
  for (const entry of entries) {
    if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
      throw new Error("All values must be integers");
    }
    if (typeof entry.memberId !== "string" || !entry.memberId) {
      throw new Error("Invalid member ID");
    }
  }

  // Validate all memberIds belong to this alliance
  const memberIds = entries.map((e) => e.memberId);
  const validMembers = await prisma.member.findMany({
    where: {
      id: { in: memberIds },
      allianceId: allianceId,
    },
    select: { id: true },
  });

  const validMemberIds = new Set(validMembers.map((m) => m.id));
  const invalidMemberIds = memberIds.filter((id) => !validMemberIds.has(id));

  if (invalidMemberIds.length > 0) {
    throw new Error("One or more members do not belong to this alliance");
  }

  // Create entries (append to history)
  await prisma.memberMetricEntry.createMany({
    data: entries.map((entry) => ({
      memberId: entry.memberId,
      periodId,
      metricId: metric.id,
      value: entry.value,
    })),
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}`);
  revalidatePath(`/alliances/${allianceId}/metrics`);

  return { success: true, count: entries.length, metricId: metric.id, metricName: metric.name };
}

export async function importMemberMetrics(
  input: ImportMetricsInput
): Promise<{ success: boolean; count: number }> {
  const user = await requireAuth();
  const { periodId, metricId, allianceId, entries } = input;

  if (!periodId || !metricId || !allianceId) {
    throw new Error("Period, metric, and alliance are required");
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("At least one entry is required");
  }

  await requireLeadershipAccess(allianceId, user.id);

  // Validate period exists and belongs to alliance
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.allianceId !== allianceId) {
    throw new Error("Period not found");
  }

  // Validate metric is configured for this period
  const periodMetric = await prisma.metricPeriodMetric.findUnique({
    where: {
      periodId_metricId: { periodId, metricId },
    },
  });

  if (!periodMetric) {
    throw new Error("Metric is not configured for this period");
  }

  // Validate all entries
  for (const entry of entries) {
    if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
      throw new Error("All values must be integers");
    }
    if (typeof entry.memberId !== "string" || !entry.memberId) {
      throw new Error("Invalid member ID");
    }
  }

  // Validate all memberIds belong to this alliance
  const memberIds = entries.map((e) => e.memberId);
  const validMembers = await prisma.member.findMany({
    where: {
      id: { in: memberIds },
      allianceId: allianceId,
    },
    select: { id: true },
  });

  const validMemberIds = new Set(validMembers.map((m) => m.id));
  const invalidMemberIds = memberIds.filter((id) => !validMemberIds.has(id));

  if (invalidMemberIds.length > 0) {
    throw new Error("One or more members do not belong to this alliance");
  }

  // Create entries (append to history)
  await prisma.memberMetricEntry.createMany({
    data: entries.map((entry) => ({
      memberId: entry.memberId,
      periodId,
      metricId,
      value: entry.value,
    })),
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);

  return { success: true, count: entries.length };
}
