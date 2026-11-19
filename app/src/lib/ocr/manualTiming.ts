import "server-only";
import { prisma } from "../prisma";
import { localOcrFixtureEnabled, ocrPreferencesAvailable, OcrEvaluationError } from "./config";
import { checkOcrDeploymentIsolation } from "./deploymentIsolation";
import { requireOcrRollout } from "./rollout";

export function manualTimingIsolated() {
  return ocrPreferencesAvailable() && (localOcrFixtureEnabled() || checkOcrDeploymentIsolation(process.env).length === 0);
}

export async function manualTimingAvailable(userId: string, allianceId: string) {
  if (!manualTimingIsolated()) return false;
  try { await requireOcrRollout({ userId, allianceId }); return true; }
  catch (error) { if (error instanceof OcrEvaluationError) return false; throw error; }
}

export function openManualTiming(userId: string, allianceId: string, periodId: string) {
  return prisma.qaManualTiming.findFirst({
    where: { userId, allianceId, periodId, endedAt: null }, select: { id: true, metricId: true },
  });
}
