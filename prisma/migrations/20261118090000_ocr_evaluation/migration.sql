CREATE TABLE "OcrEvaluationBudget" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'acc-managed-ocr-v1'),
  "reservedMicros" INTEGER NOT NULL DEFAULT 0 CHECK ("reservedMicros" BETWEEN 0 AND 5000000),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 500),
  "storedBytes" INTEGER NOT NULL DEFAULT 0 CHECK ("storedBytes" BETWEEN 0 AND 524288000),
  "reads" INTEGER NOT NULL DEFAULT 0 CHECK ("reads" BETWEEN 0 AND 5000)
);
INSERT INTO "OcrEvaluationBudget" ("id") VALUES ('acc-managed-ocr-v1');
CREATE TABLE "OcrEvaluationAttempt" (
  "id" TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "allianceId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL CHECK ("actorRole" IN ('OWNER','ADMIN','LEADER','MEMBER')),
  "playerName" TEXT NOT NULL,
  "allianceName" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "contextKey" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "processingVersion" TEXT NOT NULL,
  "imageBytes" INTEGER NOT NULL CHECK ("imageBytes" BETWEEN 1 AND 1048576),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING' CHECK ("status" IN ('PROCESSING','READY','FAILED')),
  "outcome" TEXT,
  CONSTRAINT "OcrEvaluationAttempt_expiry" CHECK ("expiresAt" = "createdAt" + INTERVAL '30 days')
);
CREATE UNIQUE INDEX "OcrEvaluationAttempt_actorUserId_requestId_key" ON "OcrEvaluationAttempt"("actorUserId", "requestId");
CREATE INDEX "OcrEvaluationAttempt_allianceId_memberId_createdAt_idx" ON "OcrEvaluationAttempt"("allianceId", "memberId", "createdAt");
CREATE INDEX "OcrEvaluationAttempt_actorUserId_createdAt_idx" ON "OcrEvaluationAttempt"("actorUserId", "createdAt");

CREATE FUNCTION protect_ocr_evaluation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OCR evaluation audit is immutable'; END IF;
  IF (to_jsonb(NEW) - 'status' - 'outcome') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'outcome')
    OR OLD."status" <> 'PROCESSING' OR NEW."status" NOT IN ('READY','FAILED') THEN
    RAISE EXCEPTION 'OCR evaluation audit is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ocr_evaluation_audit_immutable BEFORE UPDATE OR DELETE ON "OcrEvaluationAttempt"
  FOR EACH ROW EXECUTE FUNCTION protect_ocr_evaluation_audit();

CREATE FUNCTION protect_ocr_evaluation_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OCR evaluation allowance cannot be reset'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."reservedMicros" < OLD."reservedMicros"
    OR NEW."attempts" < OLD."attempts" OR NEW."storedBytes" < OLD."storedBytes" OR NEW."reads" < OLD."reads" THEN
    RAISE EXCEPTION 'OCR evaluation allowance cannot be reset';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ocr_evaluation_budget_monotonic BEFORE UPDATE OR DELETE ON "OcrEvaluationBudget"
  FOR EACH ROW EXECUTE FUNCTION protect_ocr_evaluation_budget();
