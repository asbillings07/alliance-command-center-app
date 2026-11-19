import "server-only";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "../auth/requirePlatformAdmin";
import { OCR_CAMPAIGN, localOcrFixtureEnabled, ocrPreferencesAvailable } from "../ocr/config";
import { checkOcrDeploymentIsolation, isLocalOcrDatabase } from "../ocr/deploymentIsolation";
import { qaManualTimingSummary } from "./qaManualTimingSummary";
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
