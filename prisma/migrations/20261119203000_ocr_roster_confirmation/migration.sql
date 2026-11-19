ALTER TABLE "OcrScoreBatch" ADD COLUMN "confirmationDigest" TEXT;
CREATE UNIQUE INDEX "OcrScoreBatch_confirmationDigest_key" ON "OcrScoreBatch"("confirmationDigest");
ALTER TABLE "MemberMetricEntry" ADD COLUMN "ocrCreatedRosterMember" BOOLEAN NOT NULL DEFAULT false;
