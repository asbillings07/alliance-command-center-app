-- Convert BetaInvitation into a history table
-- Drop the unique constraint on email so an email can have many invitation records

-- DropIndex
DROP INDEX "BetaInvitation_email_key";

-- AlterTable
ALTER TABLE "BetaInvitation" ADD COLUMN     "campaign" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill issuedAt from createdAt for existing rows so history reads correctly
UPDATE "BetaInvitation" SET "issuedAt" = "createdAt";

-- CreateIndex
CREATE INDEX "BetaInvitation_email_idx" ON "BetaInvitation"("email");
