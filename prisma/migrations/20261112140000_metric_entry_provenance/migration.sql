-- Expand only: old application instances may still omit attribution.
-- Existing rows stay unknown. Never infer an uploader from today's roles.
CREATE TYPE "MetricEntryMethod" AS ENUM ('MANUAL', 'SPREADSHEET_SINGLE_PERIOD', 'SPREADSHEET_MULTI_PERIOD');
ALTER TABLE "MemberMetricEntry"
  ADD COLUMN "enteredByUserId" TEXT,
  ADD COLUMN "enteredByName" TEXT,
  ADD COLUMN "enteredByRole" "AllianceRole",
  ADD COLUMN "entryMethod" "MetricEntryMethod",
  ADD CONSTRAINT "member_metric_entry_provenance_complete" CHECK (
    ("enteredByUserId" IS NULL AND "enteredByName" IS NULL AND "enteredByRole" IS NULL AND "entryMethod" IS NULL)
    OR
    ("enteredByUserId" IS NOT NULL AND length(trim("enteredByUserId")) > 0
      AND "enteredByName" IS NOT NULL AND length(trim("enteredByName")) > 0
      AND "enteredByRole" IS NOT NULL AND "entryMethod" IS NOT NULL)
  );
-- The existing whole-row UPDATE rejection also protects the new columns.
CREATE INDEX "member_metric_entry_history_idx" ON "MemberMetricEntry"
  ("allianceMemberId", "recordedAt" DESC, "createdAt" DESC, "id" DESC);
