"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { manualTimingAvailable, openManualTiming } from "@/app/src/lib/ocr/manualTiming";

async function timingUser(allianceId: string) {
  const { user } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.IMPORT_METRICS });
  if (!await manualTimingAvailable(user.id, allianceId)) throw new Error("QA timing is unavailable.");
  return user.id;
}

export async function startManualTiming(allianceId: string, periodId: string, metricId: string) {
  const userId = await timingUser(allianceId);
  const metric = await prisma.metricPeriodMetric.findFirst({ where: {
    periodId, metricId, active: true, period: { allianceId }, metric: { allianceId, observationGrain: "PERIOD_VALUE" },
  }, select: { metricId: true } });
  if (!metric) throw new Error("Choose an available period metric.");
  await prisma.qaManualTiming.createMany({ data: [{ userId, allianceId, periodId, metricId }], skipDuplicates: true });
  const open = await openManualTiming(userId, allianceId, periodId);
  if (!open || open.metricId !== metricId) throw new Error("Refresh to resume the current timed entry.");
  return open;
}

export async function stopManualTiming(allianceId: string, periodId: string, id: string) {
  const userId = await timingUser(allianceId);
  await prisma.qaManualTiming.updateMany({ where: { id, userId, allianceId, periodId, endedAt: null }, data: { endedAt: new Date() } });
}
