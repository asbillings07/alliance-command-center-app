-- Forward-only migration: Rename Member to AllianceMember
-- This migration preserves all existing data and updates schema to match new domain model

-- Step 1: Drop foreign key constraints that reference Member
ALTER TABLE "LeadershipNote" DROP CONSTRAINT "LeadershipNote_memberId_fkey";
ALTER TABLE "MemberMetricEntry" DROP CONSTRAINT "MemberMetricEntry_memberId_fkey";

-- Step 2: Drop the old global unique constraint on playerName
ALTER TABLE "Member" DROP CONSTRAINT "Member_playerName_key";

-- Step 3: Drop indexes that reference memberId
DROP INDEX "MemberMetricEntry_memberId_periodId_idx";

-- Step 4: Rename the Member table to AllianceMember
ALTER TABLE "Member" RENAME TO "AllianceMember";

-- Step 5: Rename memberId columns to allianceMemberId
ALTER TABLE "LeadershipNote" RENAME COLUMN "memberId" TO "allianceMemberId";
ALTER TABLE "MemberMetricEntry" RENAME COLUMN "memberId" TO "allianceMemberId";

-- Step 6: Add composite unique constraint (playerName unique within alliance, not globally)
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_allianceId_playerName_key" UNIQUE ("allianceId", "playerName");

-- Step 7: Re-create indexes with new column names
CREATE INDEX "MemberMetricEntry_allianceMemberId_periodId_idx" ON "MemberMetricEntry"("allianceMemberId", "periodId");

-- Step 8: Re-add foreign key constraints pointing to AllianceMember
ALTER TABLE "LeadershipNote" ADD CONSTRAINT "LeadershipNote_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "MemberMetricEntry_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
