"use server";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
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

export async function importMemberMetrics(
  input: ImportMetricsInput,
): Promise<{ success: boolean; count: number }> {
  const user = await requireAuth();
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

  const { period } = await requirePeriodAccess(periodId, allianceId, user.id);

  // Validate metric is configured for this period
  const periodMetric = await prisma.metricPeriodMetric.findUnique({
    where: {
      periodId_metricId: { periodId: period.id, metricId },
    },
  });

  if (!periodMetric) {
    throw new Error("Metric is not configured for this period");
  }

  // Validate all memberIds belong to this alliance
  const memberIds = dedupedEntries.map((e) => e.memberId);
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
    data: dedupedEntries.map((entry) => ({
      memberId: entry.memberId,
      periodId,
      metricId,
      value: entry.value,
    })),
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);

  return { success: true, count: dedupedEntries.length };
}
