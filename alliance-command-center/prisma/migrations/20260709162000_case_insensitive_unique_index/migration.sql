-- Add case-insensitive unique index for playerName
-- This prevents duplicates that only differ by case (e.g., "Alice" vs "alice")
-- The existing case-sensitive @@unique is kept for Prisma upsert compatibility

CREATE UNIQUE INDEX "AllianceMember_allianceId_playerName_lower_idx" 
ON "AllianceMember"("allianceId", lower("playerName"));
