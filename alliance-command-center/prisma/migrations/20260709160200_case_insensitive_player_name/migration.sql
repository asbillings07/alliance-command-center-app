-- Enforce case-insensitive uniqueness for playerName at the database level
-- This prevents race conditions where concurrent writes could create duplicates
-- that only differ in case (e.g., "Dragon" and "dragon")

-- Drop the existing case-sensitive unique constraint
ALTER TABLE "AllianceMember" DROP CONSTRAINT "AllianceMember_allianceId_playerName_key";

-- Create a new unique index on (allianceId, lower(playerName)) for case-insensitive uniqueness
CREATE UNIQUE INDEX "AllianceMember_allianceId_playerName_lower_idx" ON "AllianceMember"("allianceId", lower("playerName"));
