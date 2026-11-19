CREATE TABLE "OcrQaAllianceNameChange" (
  "id" SERIAL PRIMARY KEY,
  "allianceId" TEXT NOT NULL,
  "previousName" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (length(trim("name")) BETWEEN 1 AND 200),
  "server" TEXT NOT NULL,
  "allianceVersion" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("previousName" <> "name")
);
CREATE INDEX "OcrQaAllianceNameChange_allianceId_id_idx" ON "OcrQaAllianceNameChange" ("allianceId", "id");
CREATE FUNCTION immutable_ocr_qa_alliance_name_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OCR QA alliance name history is immutable';
END; $$;
CREATE TRIGGER immutable_ocr_qa_alliance_name_change BEFORE UPDATE OR DELETE ON "OcrQaAllianceNameChange"
  FOR EACH ROW EXECUTE FUNCTION immutable_ocr_qa_alliance_name_change();
