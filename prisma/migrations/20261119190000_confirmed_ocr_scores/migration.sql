ALTER TYPE "MetricEntryMethod" ADD VALUE 'OCR_SCREENSHOT';
CREATE TABLE "OcrScoreBatch" (
  id TEXT PRIMARY KEY, "allianceId" TEXT NOT NULL, "periodId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL, "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "excludedRows" INTEGER NOT NULL CHECK ("excludedRows" >= 0)
);
CREATE INDEX "OcrScoreBatch_allianceId_periodId_savedAt_idx" ON "OcrScoreBatch" ("allianceId","periodId","savedAt");
ALTER TABLE "MemberMetricEntry" ADD COLUMN "ocrBatchId" TEXT REFERENCES "OcrScoreBatch"(id) ON DELETE RESTRICT;
CREATE INDEX "MemberMetricEntry_ocrBatchId_idx" ON "MemberMetricEntry" ("ocrBatchId") WHERE "ocrBatchId" IS NOT NULL;
CREATE TABLE "OcrScoreSource" (
  "attemptId" TEXT NOT NULL REFERENCES "OcrEvaluationAttempt"(id) ON DELETE RESTRICT,
  "rowKey" TEXT NOT NULL, "entryId" TEXT NOT NULL REFERENCES "MemberMetricEntry"(id) ON DELETE RESTRICT,
  "window" TEXT NOT NULL, PRIMARY KEY ("attemptId","rowKey")
);
CREATE INDEX "OcrScoreSource_entryId_idx" ON "OcrScoreSource" ("entryId");
