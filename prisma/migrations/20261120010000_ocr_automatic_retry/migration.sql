ALTER TABLE "OcrEvaluationAttempt"
  ADD COLUMN "automaticRetry" BOOLEAN NOT NULL DEFAULT false,
  DROP CONSTRAINT "OcrEvaluationAttempt_retry_scope",
  ADD CONSTRAINT "OcrEvaluationAttempt_retry_scope" CHECK (
    ("retryOf" IS NULL AND NOT "automaticRetry") OR
    ("retryOf" IS NOT NULL AND "retryOf" <> "id" AND ("memberId" IS NULL OR "automaticRetry"))
  );
