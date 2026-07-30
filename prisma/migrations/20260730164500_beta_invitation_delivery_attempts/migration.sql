-- CreateEnum
CREATE TYPE "BetaInvitationDeliveryTrigger" AS ENUM ('ISSUE', 'RESEND', 'REISSUE');

-- CreateEnum
CREATE TYPE "BetaInvitationDeliveryStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "BetaInvitationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "trigger" "BetaInvitationDeliveryTrigger" NOT NULL,
    "status" "BetaInvitationDeliveryStatus" NOT NULL,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "attemptedByUserId" TEXT,
    "attemptedByEmail" TEXT NOT NULL,
    "attemptedByDisplayName" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaInvitationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetaInvitationDeliveryAttempt_invitationId_createdAt_id_idx" ON "BetaInvitationDeliveryAttempt"("invitationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "BetaInvitationDeliveryAttempt_attemptedByUserId_idx" ON "BetaInvitationDeliveryAttempt"("attemptedByUserId");

-- AddForeignKey
ALTER TABLE "BetaInvitationDeliveryAttempt" ADD CONSTRAINT "BetaInvitationDeliveryAttempt_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "BetaInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaInvitationDeliveryAttempt" ADD CONSTRAINT "BetaInvitationDeliveryAttempt_attemptedByUserId_fkey" FOREIGN KEY ("attemptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Canonicalization invariants (#175): status <-> payload consistency is
-- enforced at the write boundary (see betaInvitation.ts), but backed here so
-- a bug there can never persist an inconsistent row.
ALTER TABLE "BetaInvitationDeliveryAttempt"
  ADD CONSTRAINT "BetaInvitationDeliveryAttempt_failureReason_length_check"
  CHECK (char_length("failureReason") <= 300);

ALTER TABLE "BetaInvitationDeliveryAttempt"
  ADD CONSTRAINT "BetaInvitationDeliveryAttempt_providerMessageId_length_check"
  CHECK (char_length("providerMessageId") <= 200);

ALTER TABLE "BetaInvitationDeliveryAttempt"
  ADD CONSTRAINT "BetaInvitationDeliveryAttempt_providerMessageId_status_check"
  CHECK ("providerMessageId" IS NULL OR status = 'SENT');

ALTER TABLE "BetaInvitationDeliveryAttempt"
  ADD CONSTRAINT "BetaInvitationDeliveryAttempt_failureReason_status_check"
  CHECK ("failureReason" IS NULL OR status = 'FAILED');

ALTER TABLE "BetaInvitationDeliveryAttempt"
  ADD CONSTRAINT "BetaInvitationDeliveryAttempt_failed_requires_reason_check"
  CHECK (status != 'FAILED' OR "failureReason" IS NOT NULL);
