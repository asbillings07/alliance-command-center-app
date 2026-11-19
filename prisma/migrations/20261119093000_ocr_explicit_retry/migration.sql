ALTER TABLE "OcrEvaluationAttempt" ADD COLUMN "retryOf" TEXT;
CREATE UNIQUE INDEX "OcrEvaluationAttempt_retryOf_key" ON "OcrEvaluationAttempt"("retryOf");
ALTER TABLE "OcrEvaluationAttempt" ADD CONSTRAINT "OcrEvaluationAttempt_retryOf_fkey"
  FOREIGN KEY ("retryOf") REFERENCES "OcrEvaluationAttempt"("id") ON DELETE RESTRICT;
ALTER TABLE "OcrEvaluationAttempt" ADD CONSTRAINT "OcrEvaluationAttempt_retry_scope"
  CHECK ("retryOf" IS NULL OR ("memberId" IS NULL AND "retryOf" <> "id"));
