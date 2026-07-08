"use server";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";

type RecordMemberMetricsInput = {
  periodId: string;
  metricId: string;
  allianceId: string;
  entries: {
    memberId: string;
    value: number;
  }[];
};

export async function recordMemberMetrics(
  input: RecordMemberMetricsInput,
): Promise<void> {
  const user = await requireAuth();
  const { periodId, metricId, allianceId, entries } = input;

  if (!periodId || !metricId || !allianceId) {
    throw new Error("Period, metric, and alliance are required");
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("At least one entry is required");
  }

  const { period } = await requirePeriodAccess(periodId, allianceId, user.id);

  // Validate metric is configured for this period
  const periodMetric = await prisma.metricPeriodMetric.findUnique({
    where: {
      periodId_metricId: { periodId, metricId },
    },
  });

  if (!periodMetric) {
    throw new Error("Metric is not configured for this period");
  }

  // Validate all entries have integer values
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

  await prisma.memberMetricEntry.createMany({
    data: entries.map((entry) => ({
      memberId: entry.memberId,
      periodId,
      metricId,
      value: entry.value,
    })),
  });

  revalidatePath(`/alliances/${period.allianceId}/periods/${period.id}/record`);
}
