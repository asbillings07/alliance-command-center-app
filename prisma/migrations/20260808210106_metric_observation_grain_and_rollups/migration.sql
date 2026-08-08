-- ADR-018 / #287 Phase 1 ("Expand" — see docs/database-design/287-metric-observations-and-member-period-rollups.md §1).
--
-- This migration only ADDS columns/constraints/triggers, all backward-compatible
-- with every writer that predates this PR: the three new NOT NULL columns each
-- carry a temporary constant default so an old, still-warm instance's INSERT
-- (issued between `prisma migrate deploy` completing and this deploy's code
-- fully taking over traffic) continues to succeed unchanged. Those three
-- defaults (Metric.observationGrain, Metric.memberPeriodRollup,
-- MemberMetricEntry.observationGrain) are dropped in a separate, later Phase 3
-- migration once every writer supplies them explicitly (§1) — never in this
-- migration. MemberMetricEntry.status's ACTIVE default is not part of that
-- risk and is permanent (ADR-018 §2).

-- CreateEnum
CREATE TYPE "MetricObservationGrain" AS ENUM ('PERIOD_VALUE', 'DAILY_OBSERVATION');

-- CreateEnum
CREATE TYPE "MemberPeriodRollupKind" AS ENUM ('LATEST', 'SUM', 'AVERAGE');

-- CreateEnum
CREATE TYPE "MemberMetricEntryStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- AlterTable
ALTER TABLE "Metric" ADD COLUMN     "memberPeriodRollup" "MemberPeriodRollupKind" NOT NULL DEFAULT 'LATEST',
ADD COLUMN     "observationGrain" "MetricObservationGrain" NOT NULL DEFAULT 'PERIOD_VALUE';

-- CreateIndex
-- Required as a composite foreign-key target for MemberMetricEntry's grain
-- snapshot below (ADR-018 §3) — must exist before that foreign key can be
-- added. Redundant with the primary key alone, but a composite FK's target
-- columns must themselves be under a unique constraint together.
CREATE UNIQUE INDEX "Metric_id_observationGrain_key" ON "Metric"("id", "observationGrain");

-- AlterTable
ALTER TABLE "MemberMetricEntry" ADD COLUMN     "observationGrain" "MetricObservationGrain" NOT NULL DEFAULT 'PERIOD_VALUE',
ADD COLUMN     "observedOn" DATE,
ADD COLUMN     "status" "MemberMetricEntryStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "value" DROP NOT NULL;

-- CheckConstraint (database design §3a): Metric grain/rollup/type compatibility.
-- Extends, does not replace, the existing metric_summary_kind_matches_type CHECK.
ALTER TABLE "Metric" ADD CONSTRAINT "metric_observation_grain_matches_rollup" CHECK (
  ("observationGrain" = 'PERIOD_VALUE' AND "memberPeriodRollup" = 'LATEST')
  OR (
    "observationGrain" = 'DAILY_OBSERVATION'
    AND "memberPeriodRollup" IN ('LATEST', 'SUM', 'AVERAGE')
    AND "type" = 'NUMERIC'
  )
);

-- CheckConstraint (database design §3b): MemberMetricEntry status/value
-- consistency (ADR-018 §2's tombstone state machine).
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "member_metric_entry_status_value_consistency" CHECK (
  ("status" = 'ACTIVE' AND "value" IS NOT NULL)
  OR ("status" = 'VOIDED' AND "value" IS NULL)
);

-- CheckConstraint (database design §3c): MemberMetricEntry grain/observedOn
-- consistency (ADR-018 §3).
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "member_metric_entry_grain_observed_on_consistency" CHECK (
  ("observationGrain" = 'DAILY_OBSERVATION' AND "observedOn" IS NOT NULL)
  OR ("observationGrain" = 'PERIOD_VALUE' AND "observedOn" IS NULL)
);

-- AddForeignKey (database design §3d): grain snapshot composite foreign key —
-- the actual guarantee a CHECK alone cannot provide, since a CHECK cannot
-- join to Metric. Backed by Metric_id_observationGrain_key above.
-- ON DELETE RESTRICT / ON UPDATE CASCADE matches this schema's convention for
-- every other required relation (Prisma's default for a non-optional
-- relation) rather than the design doc's no-op-action illustration: RESTRICT
-- also correctly prevents deleting a Metric that still has grain-matched
-- MemberMetricEntry rows, consistent with ADR-004's historical-preservation
-- rule.
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "member_metric_entry_metric_grain_fkey"
  FOREIGN KEY ("metricId", "observationGrain") REFERENCES "Metric"("id", "observationGrain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigger (database design §4a): Metric.type/observationGrain/memberPeriodRollup
-- creation-time immutability — a strictly stronger guarantee than the existing
-- app-only `type` precedent in metrics/action.ts.
CREATE OR REPLACE FUNCTION metric_reporting_fields_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."observationGrain" IS DISTINCT FROM OLD."observationGrain"
     OR NEW."memberPeriodRollup" IS DISTINCT FROM OLD."memberPeriodRollup" THEN
    RAISE EXCEPTION 'Metric.type, observationGrain, and memberPeriodRollup are immutable after creation (id=%)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metric_reporting_fields_immutable_trigger
BEFORE UPDATE ON "Metric"
FOR EACH ROW
EXECUTE FUNCTION metric_reporting_fields_immutable();

-- Trigger (database design §4b): MetricPeriod boundary immutability once a
-- daily observation exists. Checks existence directly rather than a stored
-- flag — one less piece of redundant state to keep in sync.
CREATE OR REPLACE FUNCTION metric_period_boundaries_immutable_after_daily_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt")
     AND EXISTS (
       SELECT 1 FROM "MemberMetricEntry"
       WHERE "periodId" = OLD.id AND "observationGrain" = 'DAILY_OBSERVATION'
     ) THEN
    RAISE EXCEPTION 'Period % boundaries are immutable once a daily observation has been recorded', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metric_period_boundaries_immutable_after_daily_entry_trigger
BEFORE UPDATE ON "MetricPeriod"
FOR EACH ROW
EXECUTE FUNCTION metric_period_boundaries_immutable_after_daily_entry();

-- Trigger (database design §4c): MemberMetricEntry insert-time validation —
-- both period boundaries required, observedOn in range. Uses SELECT ... FOR
-- SHARE (not a plain SELECT) to serialize against a concurrent boundary
-- UPDATE on the same MetricPeriod row: UPDATE always acquires a row-level
-- lock that conflicts with FOR SHARE, so whichever transaction reaches the
-- row first forces the other to wait until it commits or rolls back.
--
-- This trigger's range comparison does not separately raise on a NULL
-- observedOn: both comparisons evaluate to NULL (not TRUE) when observedOn is
-- NULL, so the IF above silently passes. This is not a gap — PostgreSQL
-- validates CHECK constraints (including member_metric_entry_grain_observed_
-- on_consistency's observedOn IS NOT NULL requirement for DAILY_OBSERVATION
-- rows) against each row's final values only after every BEFORE ROW trigger
-- has run, so a NULL observedOn is always rejected by that CHECK immediately
-- after this trigger returns, regardless of ordering.
CREATE OR REPLACE FUNCTION member_metric_entry_validate_daily_observation()
RETURNS TRIGGER AS $$
DECLARE
  period_starts_at TIMESTAMP(3);
  period_ends_at   TIMESTAMP(3);
BEGIN
  IF NEW."observationGrain" = 'DAILY_OBSERVATION' THEN
    SELECT "startsAt", "endsAt" INTO period_starts_at, period_ends_at
    FROM "MetricPeriod" WHERE id = NEW."periodId" FOR SHARE;

    IF period_starts_at IS NULL OR period_ends_at IS NULL THEN
      RAISE EXCEPTION 'Period % must have both start and end dates set before recording a daily observation', NEW."periodId";
    END IF;

    IF NEW."observedOn" < period_starts_at::date OR NEW."observedOn" > period_ends_at::date THEN
      RAISE EXCEPTION 'observedOn % is outside period % boundaries', NEW."observedOn", NEW."periodId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER member_metric_entry_validate_daily_observation_trigger
BEFORE INSERT ON "MemberMetricEntry"
FOR EACH ROW
EXECUTE FUNCTION member_metric_entry_validate_daily_observation();

-- Trigger (database design §4d): MemberMetricEntry full immutability after
-- insert. §4c only validates at INSERT time; nothing else would stop a
-- subsequent raw UPDATE from moving an already-validated row's observedOn or
-- periodId into a combination that was never checked, or reassigning
-- metricId/allianceMemberId entirely. ADR-018 §2 already treats this table as
-- append-only — every legitimate change is a new row (a correction or a
-- void), never an in-place edit — so no field of an existing row may ever
-- change, full stop, rather than selectively re-validating specific fields.
CREATE OR REPLACE FUNCTION member_metric_entry_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'MemberMetricEntry rows are immutable after insert (id=%) — write a new row (correction or void) instead of updating an existing one', OLD.id;
  RETURN NEW; -- unreachable; RAISE EXCEPTION above always aborts the statement
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER member_metric_entry_immutable_trigger
BEFORE UPDATE ON "MemberMetricEntry"
FOR EACH ROW
EXECUTE FUNCTION member_metric_entry_immutable();

-- CreateIndex (database design §2, new): serves DAILY_OBSERVATION metrics'
-- per-slot winner resolution (partition by periodId, metricId,
-- allianceMemberId, observedOn; order by recordedAt/createdAt/id desc) and
-- the correction-lookup UI's "find this exact date's history for this
-- member/metric" query.
CREATE INDEX "MemberMetricEntry_periodId_metricId_allianceMemberId_observ_idx" ON "MemberMetricEntry"("periodId", "metricId", "allianceMemberId", "observedOn", "recordedAt" DESC, "createdAt" DESC, "id" DESC);
