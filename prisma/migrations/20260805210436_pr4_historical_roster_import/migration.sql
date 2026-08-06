-- CreateEnum
CREATE TYPE "MemberImportMode" AS ENUM ('CURRENT', 'HISTORICAL');

-- AlterTable
ALTER TABLE "MemberImport" ADD COLUMN     "createdArchivedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mode" "MemberImportMode" NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "skippedLifecycleConflictCount" INTEGER NOT NULL DEFAULT 0;

-- #277 PR 4 (#282): defensive CHECK constraints matching the same
-- application-invariants-as-DB-constraints precedent as
-- MemberImport_counts_nonnegative_check (see the original PR 1 migration).
-- createdArchivedCount is a *subset* of createdCount (every archived
-- creation is also counted in createdCount), never negative, and never
-- exceeds it.
ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_createdArchivedCount_subset_check"
  CHECK ("createdArchivedCount" >= 0 AND "createdArchivedCount" <= "createdCount");

ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_skippedLifecycleConflictCount_nonnegative_check"
  CHECK ("skippedLifecycleConflictCount" >= 0);

-- Historical-only counts (createdArchivedCount, skippedLifecycleConflictCount)
-- are always 0 for a CURRENT-mode import — historicalAction.ts is the only
-- writer that can produce non-zero values, and ../action.ts's importMembers()
-- never sets them. Enforcing this as a CHECK constraint (rather than trusting
-- every future writer) means a bug in an import writer can't persist a
-- CURRENT-mode row with misleading historical-only counts.
ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_current_mode_zero_historical_counts_check"
  CHECK (
    "mode" != 'CURRENT'
    OR ("createdArchivedCount" = 0 AND "skippedLifecycleConflictCount" = 0)
  );

-- A historical-mode row directly created archived still satisfies CREATED's
-- "member didn't exist before this import" semantics (thpBefore/roleBefore/
-- archivedAtBefore are still all null) — only archivedAtAfter differs from a
-- current-roster creation. Relax the PR 1 constraint that previously forced
-- archivedAtAfter IS NULL for every CREATED row.
ALTER TABLE "MemberImportChange" DROP CONSTRAINT "MemberImportChange_created_before_state_check";

ALTER TABLE "MemberImportChange" ADD CONSTRAINT "MemberImportChange_created_before_state_check"
  CHECK (
    "changeType" != 'CREATED'
    OR (
      "thpBefore" IS NULL
      AND "roleBefore" IS NULL
      AND "archivedAtBefore" IS NULL
    )
  );
