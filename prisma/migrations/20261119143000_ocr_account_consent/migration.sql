CREATE TYPE "OcrConsentPurpose" AS ENUM ('PROCESSING', 'QUALITY_REVIEW');
ALTER TABLE "User" ADD COLUMN "ocrConsentVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "OcrConsentDecision" (
  "id" SERIAL NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "OcrConsentPurpose" NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "noticeVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OcrConsentDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OcrConsentDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OcrConsentDecision_userId_purpose_id_idx" ON "OcrConsentDecision"("userId", "purpose", "id");
ALTER TABLE "OcrEvaluationAttempt" ADD COLUMN "processingConsentId" INTEGER, ADD COLUMN "qualityConsentId" INTEGER;
-- No consent backfill: previous per-upload permission did not grant account
-- processing permission or optional human review. Existing expiry is unchanged.
