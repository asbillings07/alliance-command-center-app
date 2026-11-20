CREATE TABLE "ImportErrorReport" (
  "id" TEXT PRIMARY KEY,
  "allianceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "scanRequestId" VARCHAR(36),
  "workflow" VARCHAR(24) NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "clientBuild" VARCHAR(7),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ImportErrorReport_createdAt_id_idx" ON "ImportErrorReport"("createdAt","id");
CREATE INDEX "ImportErrorReport_actorId_createdAt_idx" ON "ImportErrorReport"("actorId","createdAt");
