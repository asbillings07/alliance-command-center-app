CREATE TABLE "OcrReviewMilestone" (
  "id" SERIAL PRIMARY KEY,
  "allianceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "interactionId" UUID NOT NULL,
  "stage" VARCHAR(32) NOT NULL CHECK ("stage" IN ('recognition_finished', 'score_displayed', 'confirmation_dismissed')),
  "attemptIds" TEXT[] NOT NULL CHECK (cardinality("attemptIds") BETWEEN 1 AND 20),
  "clientBuild" VARCHAR(7),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OcrReviewMilestone_actorId_interactionId_stage_key" ON "OcrReviewMilestone"("actorId","interactionId","stage");
CREATE INDEX "OcrReviewMilestone_allianceId_createdAt_idx" ON "OcrReviewMilestone"("allianceId","createdAt");
CREATE INDEX "OcrReviewMilestone_actorId_createdAt_idx" ON "OcrReviewMilestone"("actorId","createdAt");
