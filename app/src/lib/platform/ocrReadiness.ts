import "server-only";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "../auth/requirePlatformAdmin";
import { OCR_CAMPAIGN, localOcrFixtureEnabled, ocrPreferencesAvailable } from "../ocr/config";
import { productionPilotConfigured } from "../ocr/productionPilot";
import { checkOcrDeploymentIsolation, isLocalOcrDatabase } from "../ocr/deploymentIsolation";
import { qaManualTimingSummary } from "./qaManualTimingSummary";
import { pilotActivityQuery, thursdayFixLiveAt } from "./ocrPilotActivity";
import { prisma } from "../prisma";

/** Read only aggregate diagnostics from the dedicated evaluation database. */
export async function getOcrReadiness() {
  await requirePlatformAdmin();
  if (!ocrPreferencesAvailable()) notFound();
  if (localOcrFixtureEnabled() ? !isLocalOcrDatabase(process.env.DATABASE_URL) : checkOcrDeploymentIsolation(process.env).length > 0) notFound();

  const countsByStatus = prisma.ocrEvaluationAttempt.groupBy({ by: ["status"], _count: { _all: true } });
  const [attempts, retries, statuses, budget, timings, confirmedBatches] = await prisma.$transaction([
    prisma.ocrEvaluationAttempt.aggregate({
      _count: true, _min: { createdAt: true }, _max: { createdAt: true },
    }),
    prisma.ocrEvaluationAttempt.count({ where: { retryOf: { not: null } } }),
    countsByStatus,
    prisma.ocrEvaluationBudget.findUnique({ where: { id: OCR_CAMPAIGN }, select: { reservedMicros: true } }),
    qaManualTimingSummary(),
    prisma.ocrScoreBatch.count(),
  ], { isolationLevel: "RepeatableRead" });

  const count = (status: string) => statuses.find(row => row.status === status)?._count._all ?? 0;
  return {
    confirmedBatches, timings, attempts: attempts._count, firstAttempts: attempts._count - retries, retries,
    ready: count("READY"), failed: count("FAILED"), processing: count("PROCESSING"),
    firstAt: attempts._min.createdAt, lastAt: attempts._max.createdAt,
    reservedMicros: budget?.reservedMicros ?? null,
  };
}


// Production counters come only from the nominated real account and alliance.
// Expose aggregate workflow counts to Platform, never recognized content.
export async function getProductionPilotCounts(sinceFix = true) {
  await requirePlatformAdmin();
  if (!productionPilotConfigured()) notFound();
  const allianceId = process.env.OCR_PILOT_ALLIANCE_ID!;
  const actorId = process.env.OCR_PILOT_USER_ID!;
  const [scans, retries, failures, saves, confirmedScores, activity] = await prisma.$transaction([
    prisma.ocrEvaluationAttempt.count({ where: { allianceId, actorUserId: actorId } }),
    prisma.ocrEvaluationAttempt.count({ where: { allianceId, actorUserId: actorId, retryOf: { not: null } } }),
    prisma.ocrEvaluationAttempt.count({ where: { allianceId, actorUserId: actorId, status: "FAILED" } }),
    prisma.ocrScoreBatch.count({ where: { allianceId, actorId } }),
    prisma.memberMetricEntry.count({ where: { ocrBatch: { allianceId, actorId } } }),
    pilotActivityQuery(allianceId, actorId, sinceFix ? new Date(thursdayFixLiveAt) : null),
  ], { isolationLevel: "RepeatableRead" });
  return { scans, retries, failures, saves, confirmedScores, activity };
}
