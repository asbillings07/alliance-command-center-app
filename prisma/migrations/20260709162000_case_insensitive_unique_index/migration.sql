-- Add case-insensitive unique index for playerName
-- This prevents duplicates that only differ by case (e.g., "Alice" vs "alice")
-- The existing case-sensitive @@unique is kept for Prisma upsert compatibility

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "AllianceMember"
        GROUP BY "allianceId", lower("playerName")
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot create case-insensitive unique index: duplicate member names exist that differ only by case.';
    END IF;
END $$;

CREATE UNIQUE INDEX "AllianceMember_allianceId_playerName_lower_idx"
ON "AllianceMember" ("allianceId", lower("playerName"));
