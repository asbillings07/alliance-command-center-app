import "server-only";
import { prisma } from "../prisma";
import { OcrEvaluationError } from "./config";
import { isolatedOcrDatabaseAvailable } from "./isolatedDatabase";
import { requireOcrRollout } from "./rollout";

export { isolatedOcrDatabaseAvailable as manualTimingIsolated } from "./isolatedDatabase";
export async function manualTimingAvailable(userId: string, allianceId: string) {
  if (!isolatedOcrDatabaseAvailable()) return false;
  try { await requireOcrRollout({ userId, allianceId }); return true; }
  catch (error) { if (error instanceof OcrEvaluationError) return false; throw error; }
}

export function openManualTiming(userId: string, allianceId: string, periodId: string) {
  return prisma.qaManualTiming.findFirst({
    where: { userId, allianceId, periodId, endedAt: null }, select: { id: true, metricId: true },
  });
}
