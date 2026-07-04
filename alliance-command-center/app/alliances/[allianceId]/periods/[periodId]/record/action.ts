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

  const { period } = await requirePeriodAccess(periodId, allianceId, user.id);

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
