CREATE TABLE "QaManualTiming" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "allianceId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL, "metricId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "savedRows" INTEGER,
  CHECK ("savedRows" IS NULL OR ("endedAt" IS NOT NULL AND "savedRows" > 0)),
  CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);
CREATE UNIQUE INDEX "QaManualTiming_open" ON "QaManualTiming" ("userId","allianceId","periodId") WHERE "endedAt" IS NULL;
