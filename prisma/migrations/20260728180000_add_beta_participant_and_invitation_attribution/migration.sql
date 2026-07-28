-- Deployment A (#174 PR 1a): expand schema with canonical beta participant identity,
-- invitation attribution/claim fields, and Alliance.setupActivityAt.
-- Nullable participantId and userId without unique constraints — contract step is PR 1b.

-- AlterTable: monotonic setup-activity clock on Alliance
ALTER TABLE "Alliance" ADD COLUMN "setupActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing alliances: use createdAt as the initial activity baseline
UPDATE "Alliance" SET "setupActivityAt" = "createdAt";

-- CreateTable: canonical beta participant identity
CREATE TABLE "BetaParticipant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "identityAmbiguous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BetaParticipant_pkey" PRIMARY KEY ("id")
);

-- AlterTable: BetaInvitation attribution, claim, and participant link fields
ALTER TABLE "BetaInvitation" ADD COLUMN     "participantId" TEXT,
ADD COLUMN     "issuedByUserId" TEXT,
ADD COLUMN     "revokedByUserId" TEXT,
ADD COLUMN     "reissuedFromInvitationId" TEXT,
ADD COLUMN     "resendClaimedAt" TIMESTAMP(3),
ADD COLUMN     "resendClaimId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill updatedAt from createdAt for existing invitation rows
UPDATE "BetaInvitation" SET "updatedAt" = "createdAt";

-- CreateIndex
CREATE INDEX "BetaInvitation_participantId_idx" ON "BetaInvitation"("participantId");

-- AddForeignKey
ALTER TABLE "BetaParticipant" ADD CONSTRAINT "BetaParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "BetaParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_reissuedFromInvitationId_fkey" FOREIGN KEY ("reissuedFromInvitationId") REFERENCES "BetaInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
