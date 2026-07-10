-- Roster Management Schema Changes
-- Replace active Boolean with archivedAt DateTime for richer history
-- Rename joinDate to joinedAt for consistency
-- Add composite index for common query pattern

-- Step 1: Add new archivedAt column (null = active, non-null = archived)
ALTER TABLE "AllianceMember" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Step 2: Migrate existing data - archived members get archivedAt set to updatedAt
UPDATE "AllianceMember" SET "archivedAt" = "updatedAt" WHERE "active" = false;

-- Step 3: Drop the old active column
ALTER TABLE "AllianceMember" DROP COLUMN "active";

-- Step 4: Rename joinDate to joinedAt for naming consistency
ALTER TABLE "AllianceMember" RENAME COLUMN "joinDate" TO "joinedAt";

-- Step 5: Add composite index for efficient filtering by alliance + archived status
-- Supports: members list, member picker, import duplicate detection, dashboard
CREATE INDEX "AllianceMember_allianceId_archivedAt_idx" ON "AllianceMember"("allianceId", "archivedAt");
