CREATE TABLE "OcrPendingRequest" (
    "actorUserId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL REFERENCES "OcrEvaluationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("actorUserId", "requestId")
);
CREATE INDEX "OcrPendingRequest_attemptId_idx" ON "OcrPendingRequest"("attemptId");
