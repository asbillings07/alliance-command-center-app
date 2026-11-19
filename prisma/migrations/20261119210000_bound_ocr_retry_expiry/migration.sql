-- First scans retain the original 30-day window. A retry can expire sooner
-- because its source screenshot already has a retention deadline.
ALTER TABLE "OcrEvaluationAttempt"
  DROP CONSTRAINT "OcrEvaluationAttempt_expiry",
  ADD CONSTRAINT "OcrEvaluationAttempt_expiry" CHECK (
    "expiresAt" = "createdAt" + INTERVAL '30 days'
    OR ("retryOf" IS NOT NULL AND "expiresAt" > "createdAt"
        AND "expiresAt" < "createdAt" + INTERVAL '30 days')
  );
