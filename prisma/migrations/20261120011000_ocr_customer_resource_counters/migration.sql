-- Customer attempts are metered in upload history. Their storage and read
-- safeguards have independent counters so testing cannot exhaust either.
ALTER TABLE "OcrEvaluationBudget"
  DROP CONSTRAINT "OcrEvaluationBudget_id_check",
  ADD CONSTRAINT "OcrEvaluationBudget_id_check" CHECK (
    "id" = 'acc-managed-ocr-v1' OR
    ("id" = 'acc-customer-ocr-resources-v1' AND "reservedMicros" = 0 AND "attempts" = 0)
  );
INSERT INTO "OcrEvaluationBudget" ("id") VALUES ('acc-customer-ocr-resources-v1');
