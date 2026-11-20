import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { allianceRejectionMessage, isAllianceRejection } from "../ocr/allianceEvidence";
import { recognitionFailureMessage } from "../ocr/recognitionFailure";

// Vercel assigned alliancehqapp.com to release 36cff5f at this instant.
export const thursdayFixLiveAt = "2026-11-19T23:52:02.959Z";

const failureStages = new Map([
  ["allowance", "The app could not reserve the scan allowance."],
  ["access-check", "The app could not verify access during the scan."],
  ["source-storage", "The original screenshot could not be stored."],
  ["recognition", "Text recognition failed. The specific cause was not recorded."],
  ["result-storage", "The scan result could not be stored."],
  ["finalization", "The app could not finish recording the scan."],
]);

export function pilotError(status: string, outcome: string | null) {
  if (status !== "FAILED") return null;
  if (isAllianceRejection({ outcome })) return allianceRejectionMessage(outcome);
  return recognitionFailureMessage(outcome) ?? failureStages.get(outcome?.replace(/^processing-failed:/, "") ?? "") ?? "The failure reason was not recorded.";
}

type ActivityRow = {
  id: string; firstId: string; createdAt: Date; status: string; outcome: string | null;
  retry: boolean; automaticRetry: boolean; scores: number; lastSavedAt: Date | null;
};

// Both the attempts and saved evidence belong to the nominated pilot account and alliance.
// Image fingerprints stay inside the query and only relate identical images within this scope.
export function pilotActivityQuery(allianceId: string, actorId: string, since: Date | null) {
  return prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
    WITH scoped AS (
      SELECT a.id, a."createdAt", a.status, a.outcome, a."retryOf" IS NOT NULL AS retry, a."automaticRetry",
        first_value(a.id) OVER (PARTITION BY a."sourceDigest" ORDER BY a."createdAt", a.id) AS "firstId"
      FROM "OcrEvaluationAttempt" a
      WHERE a."allianceId" = ${allianceId} AND a."actorUserId" = ${actorId} AND a."memberId" IS NULL
    )
    SELECT a.*, saved.scores, saved."lastSavedAt" FROM scoped a
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT e.id)::int AS scores, max(b."savedAt") AS "lastSavedAt"
      FROM "OcrScoreSource" s JOIN "MemberMetricEntry" e ON e.id = s."entryId"
      JOIN "OcrScoreBatch" b ON b.id = e."ocrBatchId"
      WHERE s."attemptId" = a.id AND b."allianceId" = ${allianceId} AND b."actorId" = ${actorId}
    ) saved
    ${since ? Prisma.sql`WHERE a."createdAt" >= ${since} OR saved."lastSavedAt" >= ${since}` : Prisma.empty}
    ORDER BY greatest(a."createdAt", saved."lastSavedAt") DESC, a.id DESC LIMIT 20
  `);
}
