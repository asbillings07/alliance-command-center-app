"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";

type ImportEntry = {
  memberId: string; // allianceMemberId
  value: number;
};

type ImportMetricsInput = {
  periodId: string;
  metricId: string;
  allianceId: string;
  entries: ImportEntry[];
};

export async function importMemberMetrics(
  input: ImportMetricsInput,
): Promise<{ success: boolean; count: number }> {
  const { periodId, metricId, allianceId, entries } = input;

  if (!periodId || !metricId || !allianceId) {
    throw new Error("Period, metric, and alliance are required");
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("At least one entry is required");
  }

  // Validate all entries have valid values
  for (const entry of entries) {
    if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
      throw new Error("All values must be integers");
    }
    if (typeof entry.memberId !== "string" || !entry.memberId) {
      throw new Error("Invalid member ID");
    }
  }

  // Server-side deduplication: keep first occurrence per memberId
  // This matches UI behavior and prevents crafted requests from creating duplicates
  const seenMemberIds = new Set<string>();
  const dedupedEntries = entries.filter((entry) => {
    if (seenMemberIds.has(entry.memberId)) {
      return false;
    }
    seenMemberIds.add(entry.memberId);
    return true;
  });

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  // Validate metric is configured for this period
  const periodMetric = await prisma.metricPeriodMetric.findUnique({
    where: {
      periodId_metricId: { periodId: period.id, metricId },
    },
  });

  if (!periodMetric) {
    throw new Error("Metric is not configured for this period");
  }

  // Validate all allianceMemberIds belong to this alliance
  const allianceMemberIds = dedupedEntries.map((e) => e.memberId);
  const validAllianceMembers = await prisma.allianceMember.findMany({
    where: {
      id: { in: allianceMemberIds },
      allianceId: allianceId,
    },
    select: { id: true },
  });

  const validAllianceMemberIds = new Set(validAllianceMembers.map((m) => m.id));
  const invalidAllianceMemberIds = allianceMemberIds.filter((id) => !validAllianceMemberIds.has(id));

  if (invalidAllianceMemberIds.length > 0) {
    throw new Error("One or more members do not belong to this alliance");
  }

  // Create entries (append to history)
  await prisma.memberMetricEntry.createMany({
    data: dedupedEntries.map((entry) => ({
      allianceMemberId: entry.memberId,
      periodId,
      metricId,
      value: entry.value,
    })),
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);

  return { success: true, count: dedupedEntries.length };
}
