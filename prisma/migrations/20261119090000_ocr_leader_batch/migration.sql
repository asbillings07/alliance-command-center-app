-- Preserve all trial attempts and the same monotonic budget ledger.
ALTER TABLE "OcrEvaluationAttempt" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "OcrEvaluationAttempt" ADD CONSTRAINT "OcrEvaluationAttempt_batch_authority"
  CHECK ("memberId" IS NOT NULL OR "actorRole" IN ('OWNER','ADMIN','LEADER'));
