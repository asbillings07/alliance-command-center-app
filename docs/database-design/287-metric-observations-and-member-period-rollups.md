# Database Design: Metric Observations and Member-Period Rollups

**Issue:** [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287)

**Domain model:** [ADR-018](../adr/018-metric-observation-rollup-domain-model.md) (Accepted in this same PR — §1 below corrects the deployment mechanics ADR-018's Consequences section previously got wrong, and that correction is applied to ADR-018 itself here, not left as a standing contradiction between a merged ADR and this design)

**Date:** 2026-08-08

**First approval gate:** §1 (expand/contract deployment safety), before any other section is actionable.

---

## 1. Deployment safety analysis (the approval gate)

ADR-018's own Consequences section previously said the legacy backfill and the removal of its temporary defaults happen "in the same migration." That is unsafe under this project's actual deployment pipeline. This design corrects it before anything else, and that correction is not merely asserted here — it is applied directly to ADR-018's own text in this PR, so the merged ADR and this design agree rather than one silently superseding the other.

**The pipeline, per [ADR-011](../adr/011-continuous-delivery.md)'s Deployment Pipeline section:**

```
Merge to main → Vercel Build (1. prisma generate  2. prisma migrate deploy  3. next build) → Production Deploy
```

`prisma migrate deploy` runs **before** the new application code takes over traffic, in one automated, non-blue/green pipeline (ADR-011 explicitly lists blue/green and canary as "Not Included"). Between "migrate deploy completes" and "the new deployment is fully serving all traffic," requests can still be handled by the **previous** deployment's code, against the **already-migrated** database. This is an ordinary N/N-1 compatibility window, not a hypothetical:

- If a single migration adds `Metric.observationGrain`/`memberPeriodRollup` and `MemberMetricEntry.observationGrain` as `NOT NULL` **and removes their defaults in the same step**, any `INSERT` issued by the old code during that window — which does not know these columns exist — fails outright with a `NOT NULL` violation and no default to fall back on. `recordMemberMetrics`, the single-period importer, and the multi-period importer would all break for the duration of the window.
- `MemberMetricEntry.status`'s `ACTIVE` default is not part of this risk — it is a permanent default (ADR-018 §2), never dropped, so there is no window where it causes this failure mode.

**Resolution: split into two migrations across two separate merges (expand, then contract), never combined:**

| Phase | Deploy | What changes | Why it's safe |
|---|---|---|---|
| **1. Expand** | N | Add all new columns as `NOT NULL` with **temporary** compatible defaults; add every CHECK/FK/trigger from §4; ship code in the same deploy that explicitly supplies the new fields on every writer | Old code's `INSERT`s (from any instance still warm during the cutover window) silently succeed via the default — behaviorally identical to today. New code writes real values explicitly, so production data stops depending on the default within seconds of full cutover |
| **2. Bake** | — | No schema change. One full deploy cycle passes with only expand-phase code live | Vercel's deployment model does not run long-lived old instances past the cutover window (no rolling/canary fleet) — a single subsequent merge is sufficient bake time. If ACC ever moves to a platform with longer-lived old instances, this phase would need an explicit metric distinguishing defaulted vs. explicit inserts before proceeding; it does not today |
| **3. Contract** | N+1, separate PR | Remove `@default(...)` from `Metric.observationGrain`, `Metric.memberPeriodRollup`, and `MemberMetricEntry.observationGrain` in `schema.prisma`; `prisma migrate dev` generates the resulting `ALTER COLUMN ... DROP DEFAULT` automatically — no hand-written SQL needed for this step | By now only expand-phase-or-later code is live, and it always supplies these fields explicitly (ADR-018 §1's "a new metric must select both explicitly" requirement becomes enforceable at the database level only from this point forward) |

Phase 1 and Phase 3 are each their own PR and their own `main` merge — never squashed into one. Phase 2 has no artifact; it is calendar time between them (in practice, "the next unrelated merge to `main` has gone out," which naturally provides more than enough separation given this project's deploy cadence).

This is the only new decision this design adds on top of ADR-018; everything below is ADR-018's domain model made concrete.

## 2. Prisma schema changes

```prisma
enum MetricObservationGrain {
  PERIOD_VALUE
  DAILY_OBSERVATION
}

enum MemberPeriodRollupKind {
  LATEST
  SUM
  AVERAGE
}

enum MemberMetricEntryStatus {
  ACTIVE
  VOIDED
}

model Metric {
  // ...existing fields unchanged...

  // ADR-018 §1. Phase 1: @default(PERIOD_VALUE)/@default(LATEST) below are
  // temporary — dropped in Phase 3 (see §1 of this design) once every writer
  // (§8) supplies both explicitly. Creation-time immutable thereafter,
  // enforced by the metric_reporting_fields_immutable_trigger in §4, not by
  // Prisma or the update action's payload shape.
  observationGrain   MetricObservationGrain @default(PERIOD_VALUE)
  memberPeriodRollup MemberPeriodRollupKind @default(LATEST)

  entries MemberMetricEntry[]

  @@unique([allianceId, name])
  // Required as a composite foreign-key target for MemberMetricEntry's grain
  // snapshot (ADR-018 §3) — redundant with the primary key alone, but a
  // composite FK's target columns must themselves be under a unique
  // constraint together.
  @@unique([id, observationGrain])
}

model MemberMetricEntry {
  id String @id @default(cuid())

  allianceMemberId String
  allianceMember   AllianceMember @relation(fields: [allianceMemberId], references: [id])

  periodId     String
  metricId     String
  periodMetric MetricPeriodMetric @relation(fields: [periodId, metricId], references: [periodId, metricId])

  // ADR-018 §3. Phase 1: @default(PERIOD_VALUE) below is temporary — dropped
  // in Phase 3, same as Metric's two fields above. Written once at insert
  // time from the metric's own grain; the composite FK below is the actual
  // guarantee that this copy can never drift from Metric.observationGrain.
  observationGrain MetricObservationGrain @default(PERIOD_VALUE)
  metric           Metric @relation(fields: [metricId, observationGrain], references: [id, observationGrain])

  // ADR-018 §4. NOT NULL iff observationGrain = DAILY_OBSERVATION (CHECK in
  // §3c), a source-declared YYYY-MM-DD civil date — see ADR-018 §4 for why
  // this is DATE, not DateTime.
  observedOn DateTime? @db.Date

  // ADR-018 §2. Permanent default — never dropped (contrast with the three
  // temporary Phase-1-only defaults above: Metric's two and this model's own
  // observationGrain).
  status MemberMetricEntryStatus @default(ACTIVE)

  // ADR-018 §2. Now nullable: a VOIDED row carries no value (CHECK in §3b).
  value Int?

  recordedAt DateTime @default(now())
  createdAt  DateTime @default(now())

  @@index([allianceMemberId, periodId])
  @@index([metricId])
  // Unchanged: still serves PERIOD_VALUE metrics' single-slot-per-member
  // "latest wins" query exactly as today (observedOn is always NULL for
  // these rows, so this index's key never needs it).
  @@index([periodId, metricId, allianceMemberId, recordedAt(sort: Desc), createdAt(sort: Desc), id(sort: Desc)])
  // New. Serves DAILY_OBSERVATION metrics' per-slot winner resolution
  // (partition by periodId, metricId, allianceMemberId, observedOn; order by
  // recordedAt/createdAt/id desc — see §8) and the correction-lookup UI's
  // "find this exact date's history for this member/metric" query. Not an
  // index-only scan (value/status aren't in the key), but eliminates the
  // sort step for both.
  @@index([periodId, metricId, allianceMemberId, observedOn, recordedAt(sort: Desc), createdAt(sort: Desc), id(sort: Desc)])
}
```

`MetricPeriod` gets **no new column**. Boundary immutability is enforced by a trigger that checks for the *existence* of a `DAILY_OBSERVATION`-grain entry (§4), not by a stored "locked" flag — one less piece of redundant state to keep in sync, consistent with the Prisma Philosophy's preference for relations over duplicated data.

## 3. Constraints, uniqueness, and indexes — exact DDL

Everything below is added in the Phase 1 migration (§1), in the same transaction as the column additions, hand-appended to the `prisma migrate dev`-generated file exactly as the `metric_summary_kind_matches_type` precedent does today ([migration](../../prisma/migrations/20260801160620_metric_summary_kind/migration.sql)).

**3a. `Metric` grain/rollup/type compatibility** (extends, does not replace, the existing `metric_summary_kind_matches_type` CHECK):

```sql
ALTER TABLE "Metric" ADD CONSTRAINT "metric_observation_grain_matches_rollup" CHECK (
  ("observationGrain" = 'PERIOD_VALUE' AND "memberPeriodRollup" = 'LATEST')
  OR (
    "observationGrain" = 'DAILY_OBSERVATION'
    AND "memberPeriodRollup" IN ('LATEST', 'SUM', 'AVERAGE')
    AND "type" = 'NUMERIC'
  )
);
```

**3b. `MemberMetricEntry` status/value consistency** (ADR-018 §2's tombstone state machine):

```sql
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "member_metric_entry_status_value_consistency" CHECK (
  ("status" = 'ACTIVE' AND "value" IS NOT NULL)
  OR ("status" = 'VOIDED' AND "value" IS NULL)
);
```

**3c. `MemberMetricEntry` grain/`observedOn` consistency** (ADR-018 §3):

```sql
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "member_metric_entry_grain_observed_on_consistency" CHECK (
  ("observationGrain" = 'DAILY_OBSERVATION' AND "observedOn" IS NOT NULL)
  OR ("observationGrain" = 'PERIOD_VALUE' AND "observedOn" IS NULL)
);
```

**3d. Grain snapshot composite foreign key** (ADR-018 §3 — the actual guarantee a CHECK alone cannot provide, since a CHECK cannot join to `Metric`):

```sql
-- Metric.@@unique([id, observationGrain]) from §2 backs this as a valid FK target.
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "member_metric_entry_metric_grain_fkey"
  FOREIGN KEY ("metricId", "observationGrain") REFERENCES "Metric"("id", "observationGrain");
```

## 4. PostgreSQL enforcement — triggers

This is the first use of a database trigger in this codebase. All four are `BEFORE` triggers that `RAISE EXCEPTION` to reject the offending statement; none rewrite `NEW`.

**4a. `Metric.type`/`observationGrain`/`memberPeriodRollup` creation-time immutability** (ADR-018 §1 — a strictly stronger guarantee than the existing app-only `type` precedent in [`metrics/action.ts`](<../../app/alliances/[allianceId]/metrics/action.ts#L201>)):

```sql
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
```

**4b. `MetricPeriod` boundary immutability once a daily observation exists** (ADR-018 §4 — checks existence directly rather than a stored flag, per §2 of this design):

```sql
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
```

The `EXISTS` check is deliberately not filtered by `status`: even a later-voided daily entry proves the period was once used to interpret a specific civil date, so its boundaries must stay stable for that historical record to remain meaningful — voiding an observation does not unlock the period.

**4c. `MemberMetricEntry` insert-time validation — both boundaries required, `observedOn` in range** (ADR-018 §4):

```sql
CREATE OR REPLACE FUNCTION member_metric_entry_validate_daily_observation()
RETURNS TRIGGER AS $$
DECLARE
  period_starts_at TIMESTAMP(3);
  period_ends_at   TIMESTAMP(3);
BEGIN
  IF NEW."observationGrain" = 'DAILY_OBSERVATION' THEN
    -- FOR SHARE, not a plain SELECT: this is the actual serialization
    -- mechanism against a concurrent boundary UPDATE, not just a read. An
    -- unlocked SELECT here would let this INSERT validate against boundaries
    -- that a concurrent transaction is simultaneously changing (or about to
    -- change) — both could then commit, leaving the observation outside the
    -- final boundaries. UPDATE "MetricPeriod" always acquires a row-level
    -- lock that conflicts with FOR SHARE, so whichever transaction (this
    -- insert, or a concurrent boundary edit) reaches the row first forces
    -- the other to wait until it commits or rolls back — see the two-session
    -- regression test in §7. A single INSERT statement only ever locks the
    -- one MetricPeriod row it targets; see the note below this trigger for
    -- why a multi-period transaction (which locks several) still cannot
    -- deadlock.
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
```

`observedOn IS NOT NULL` for `DAILY_OBSERVATION` rows is already guaranteed by the CHECK in §3c before this trigger body runs, so 4c does not re-check nullability.

**Lock ordering — the real lock sets, not a single-row simplification.** A single `INSERT` (4c) or boundary `UPDATE` (4b) each lock exactly one `MetricPeriod` row. But [`multiPeriodAction.ts:182-241`](<../../app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction.ts#L182-L241>) runs one `$transaction` that loops over several `groupPlan`s (from line 189's `for (const groupPlan of groupPlans)`), each targeting its own period (existing or newly created), and inserts that group's `MemberMetricEntry` rows before moving to the next — so a single multi-period import transaction can hold 4c's `FOR SHARE` lock on **multiple** `MetricPeriod` rows simultaneously, acquired in `groupPlans`' array order (client/leader-controlled column-mapping order, not sorted by id or any other canonical key).

This remains deadlock-safe, but for a different reason than "only one `MetricPeriod` row is locked": `FOR SHARE` locks never conflict with other `FOR SHARE` locks, on the same row or different rows, regardless of acquisition order. Two concurrent multi-period imports — even ones that touch the same two periods in opposite orders — can each acquire `FOR SHARE` on both periods without ever blocking each other, because neither is ever waiting on a lock **mode** the other holds against a `MetricPeriod` row. A deadlock cycle needs two transactions each holding a lock the other is waiting for.

**A boundary edit does acquire a second lock while holding the first — the corrected claim is about ordering, not absence.** [`periods/action.ts`](<../../app/alliances/[allianceId]/periods/action.ts>)'s three functions each `UPDATE "MetricPeriod"` and then call [`touchAllianceSetupActivity`](<../../app/src/lib/touchAllianceSetupActivity.ts>), which issues a raw `UPDATE "Alliance" SET "setupActivityAt" = ...` in the same transaction — a second, real row lock (on `Alliance`), held simultaneously with the first until commit. This is not unique to the boundary-edit path: every writer in §8's inventory that touches `MetricPeriod`/`MemberMetricEntry` also calls `touchAllianceSetupActivity` in the same transaction (`record/action.ts:97→105`, `import/action.ts:184→194`, `multiPeriodAction.ts`'s per-group inserts `→243`, and `periods/action.ts`'s `metricPeriod.update→touchAllianceSetupActivity` in each of its three functions). The actual invariant that prevents a `MetricPeriod`↔`Alliance` deadlock is that **every one of these writers acquires its `MetricPeriod`-affecting lock strictly before its `Alliance` lock, with no exception** — never the reverse order — so there is no pair of transactions holding these two locks in opposite orders to form a cycle. "No second lock" was the wrong claim; consistent ordering across every writer is the real one, and unlike the `FOR SHARE`-vs-`FOR SHARE` argument above, this one *would* break if a future writer ever locked `Alliance` before touching `MetricPeriod` in the same transaction — §7 adds a concurrency test exercising this specific pair, not just asserting it in prose.

The properties that make both parts of this section safe — every multi-lock acquirer within the `MetricPeriod` set only ever takes the mutually-compatible `FOR SHARE` mode, and every writer that also touches `Alliance` does so only after its `MetricPeriod`-affecting operation — are exhaustive over §8's writer inventory today; a future writer that takes a **conflicting** lock on more than one `MetricPeriod` row, or that locks `Alliance` before `MetricPeriod`, in a single transaction would need this analysis revisited.

A two-session test proving one insert-vs-one-boundary-edit race (§7's `metricPeriodBoundaryInsertRace.integration.test.ts`) does not exercise this multi-lock case. §7 also lists `metricPeriodBoundaryInsertRaceMultiPeriod.integration.test.ts`: a multi-period import transaction holding `FOR SHARE` on periods P1 and P2 (acquired in that order) runs concurrently with a second multi-period import holding `FOR SHARE` on P2 and P1 (the reverse order) — both must commit successfully, proving the opposite-order case cannot deadlock; and separately, a boundary `UPDATE` on either P1 or P2 while the first import's transaction is still open must block until that transaction commits, exactly as the single-period case does.

**4d. `MemberMetricEntry` full immutability after insert.** 4c only validates at `INSERT` time; nothing stopped a subsequent raw `UPDATE` from moving an already-validated row's `observedOn` or `periodId` to a combination that was never checked against any period's boundaries, or reassigning `metricId`/`allianceMemberId` entirely. Re-deriving and re-running 4c's validation on every `UPDATE` would work, but it fights the domain model rather than matching it: ADR-018 §2 already treats this table as append-only — every legitimate change is a new row (a correction or a void), never an in-place edit of an existing one, and no production write path calls `.update()` on it today. The correct enforcement is therefore that **no field of an existing `MemberMetricEntry` row may ever change**, which subsumes the identity-drift gap as a special case rather than patching around it:

```sql
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
```

This trigger rejects an `UPDATE` unconditionally — there is no legitimate case to allow through, so it does not need `IS DISTINCT FROM` comparisons the way 4a's field-scoped immutability does.

## 5. Legacy backfill (Phase 1 migration, exact order)

1. `CREATE TYPE` for the three new enums.
2. `ALTER TABLE "Metric" ADD COLUMN "observationGrain" ... NOT NULL DEFAULT 'PERIOD_VALUE', ADD COLUMN "memberPeriodRollup" ... NOT NULL DEFAULT 'LATEST'` — Postgres backfills every existing row as part of adding the column when the default is a constant; this is metadata-only (no table rewrite, no long lock) in modern Postgres.
3. `ALTER TABLE "MemberMetricEntry" ADD COLUMN "observationGrain" ... NOT NULL DEFAULT 'PERIOD_VALUE', ADD COLUMN "observedOn" DATE, ADD COLUMN "status" ... NOT NULL DEFAULT 'ACTIVE', ALTER COLUMN "value" DROP NOT NULL` — same metadata-only backfill for the two `NOT NULL`-with-default columns; `observedOn` is nullable from the start (no backfill needed) and `value` is being relaxed, not tightened, so it requires no validation pass either.
4. Add §3's CHECK constraints and composite FK, and §4's triggers, in that order — by this point every existing row already satisfies all of them by construction of the defaults, so constraint validation is guaranteed to pass rather than merely expected to.
5. Add §2's new index.

No down-migration is authored, consistent with every other migration in this repository and with ADR-011's "migrations are forward-only" principle. If Phase 1 surfaces a problem after deploy, the fix is a forward migration — most likely one that drops the newly-added constraint/trigger/index while leaving the additive columns in place — not a rollback. If Phase 3 (§1) is ever applied before the bake period has actually elapsed and breaks a still-running old instance, the immediate mitigation is a forward migration that re-adds the default, followed by a correctly-sequenced retry once the bake period is genuinely honored.

Per ADR-011's "test migrations against production-like data before deploy," both the Phase 1 and Phase 3 migrations must be run against a preview-branch database seeded with a representative row count before either merges — this is the operational instantiation of the legacy-metric-parity test in §7, not a substitute for it.

## 6. Canonical read-model query semantics

`memberPeriodMetricValues(allianceId, periodId, metricIds)` (ADR-018 §6) resolves in two phases, matching ADR-018 §1's rollup algebra exactly. This is illustrative SQL fixing the required *shape and invariants*; final query authoring is an Implementation-phase task, not this design's deliverable.

```sql
WITH slot_winner AS (
  -- Phase 1 (ADR-018 §2): one winning row per (metric, member, observedOn)
  -- slot, regardless of status — status is resolved *after* picking the
  -- winner, never before, so a later VOIDED row correctly beats an earlier
  -- ACTIVE one for the same slot.
  SELECT DISTINCT ON (mme."metricId", mme."allianceMemberId", mme."observedOn")
    mme."metricId", mme."allianceMemberId", mme."observedOn", mme."value", mme."status"
  FROM "MemberMetricEntry" mme
  -- Explicit join, not a bare reference to an undefined alias: tenant
  -- scoping is enforced against AllianceMember.allianceId, exactly as the
  -- eight existing "latest wins" implementations already do (ADR-018 §2's
  -- "every partition key must include metricId explicitly" applies equally
  -- to this join never being silently omitted).
  JOIN "AllianceMember" am ON am.id = mme."allianceMemberId"
  WHERE am."allianceId" = $1 AND mme."periodId" = $2 AND mme."metricId" = ANY($3)
  ORDER BY mme."metricId", mme."allianceMemberId", mme."observedOn", mme."recordedAt" DESC, mme."createdAt" DESC, mme."id" DESC
),
active_slots AS (
  -- Phase 2 input: only ACTIVE winning slots ever contribute (ADR-018 §1).
  SELECT * FROM slot_winner WHERE "status" = 'ACTIVE'
),
latest_per_member AS (
  -- LATEST: within active_slots, the greatest observedOn wins — never the
  -- most-recently-written row (ADR-018 §1's Tuesday/Friday/Saturday case).
  -- For PERIOD_VALUE metrics, observedOn is always NULL, so this trivially
  -- collapses to today's single-slot-per-member behavior.
  SELECT DISTINCT ON ("metricId", "allianceMemberId")
    "metricId", "allianceMemberId", "value"
  FROM active_slots
  ORDER BY "metricId", "allianceMemberId", "observedOn" DESC NULLS LAST
),
aggregated_per_member AS (
  -- SUM/AVERAGE: aggregate only active_slots; a voided/missing date
  -- contributes to neither the sum nor AVERAGE's denominator.
  SELECT "metricId", "allianceMemberId",
    SUM("value") AS sum_value,
    AVG("value")::float8 AS avg_value,
    COUNT(*) AS observation_count,
    MAX("observedOn") AS last_observed_on
  FROM active_slots
  GROUP BY "metricId", "allianceMemberId"
),
requested_metrics AS (
  -- Tenant-scoped a second time, independent of slot_winner's own join:
  -- an allianceId/id mismatch here means $3 can never smuggle a
  -- cross-tenant metric id into the base relation below, even if $1/$3
  -- were passed inconsistently by a caller bug.
  SELECT "id", "observationGrain", "memberPeriodRollup"
  FROM "Metric"
  WHERE "allianceId" = $1 AND "id" = ANY($3)
),
base AS (
  -- Every (requested metric x alliance member) pair, regardless of
  -- whether any MemberMetricEntry exists. This is what makes "zero
  -- active slots -> NULL" real (ADR-018 §1): without this CROSS JOIN,
  -- every CTE above is sourced from MemberMetricEntry, so a member with
  -- no rows for a metric would have no base row to LEFT JOIN onto and
  -- would be silently absent from the result set rather than returned
  -- with a NULL value.
  SELECT rm."id" AS "metricId", am."id" AS "allianceMemberId",
    rm."observationGrain", rm."memberPeriodRollup"
  FROM requested_metrics rm
  CROSS JOIN "AllianceMember" am
  WHERE am."allianceId" = $1
)
-- Final SELECT branches per Metric.memberPeriodRollup (LATEST vs. SUM vs.
-- AVERAGE) and LEFT JOINs onto `base` so a member with zero active winning
-- slots for a metric still appears with a NULL derived value (ADR-018 §1's
-- "zero active slots" rule), never absent from the result set and never
-- coerced to 0. `provenance` is ADR-018 §5's static function of
-- configuration, never inferred from whether rows happen to exist.
SELECT
  b."metricId",
  b."allianceMemberId",
  CASE b."memberPeriodRollup"
    WHEN 'LATEST' THEN lpm."value"
    WHEN 'SUM' THEN apm.sum_value
    WHEN 'AVERAGE' THEN apm.avg_value
  END AS "value",
  COALESCE(apm.observation_count, 0) AS "observationCount",
  apm.last_observed_on AS "lastObservedOn",
  CASE
    WHEN b."observationGrain" = 'PERIOD_VALUE' THEN 'Source period value'
    WHEN b."memberPeriodRollup" = 'LATEST' THEN 'Derived (latest observation)'
    WHEN b."memberPeriodRollup" = 'SUM' THEN 'Derived (sum)'
    WHEN b."memberPeriodRollup" = 'AVERAGE' THEN 'Derived (average)'
  END AS "provenance"
FROM base b
LEFT JOIN latest_per_member lpm
  ON lpm."metricId" = b."metricId" AND lpm."allianceMemberId" = b."allianceMemberId"
LEFT JOIN aggregated_per_member apm
  ON apm."metricId" = b."metricId" AND apm."allianceMemberId" = b."allianceMemberId"
ORDER BY b."metricId", b."allianceMemberId";
```

**Expected query plan:** the `slot_winner` CTE's `DISTINCT ON` is served by §2's new `(periodId, metricId, allianceMemberId, observedOn, recordedAt DESC, createdAt DESC, id DESC)` index — an index scan on the `periodId`/`metricId` predicate whose trailing key order exactly matches the `DISTINCT ON`'s `ORDER BY`, so Postgres needs no separate sort step, mirroring the reasoning already documented for the existing index. It is not an index-only scan (`value`/`status` are not in the index), so a heap fetch is still required per selected row — identical tradeoff to today's query. `base`'s `CROSS JOIN` is bounded by `$3`'s (small, caller-supplied) metric count times the alliance's member count — an index scan on `AllianceMember.allianceId` and a primary-key lookup for each `Metric` id in `$3` — never a full-table cross product.

`observationCount` and `lastObservedOn` (ADR-018 §5) are `active_slots`' `COUNT(*)`/`MAX("observedOn")` directly — never a raw row count, and never inflated by corrections or tombstones, since `slot_winner` already collapsed each slot to one row before `active_slots` filters to `ACTIVE`.

## 7. Real-Postgres test plan (concrete file list)

New `*.integration.test.ts` files (per the [`apsDataReadinessAudit.integration.test.ts`](../../app/src/lib/operations/apsDataReadinessAudit.integration.test.ts) precedent — `INTEGRATION_DB=true`, run via `npm run test:integration`), each proving one ADR-018 verification-plan bullet against a real database rather than a mocked Prisma client:

| Test file | Proves |
|---|---|
| `metricGrainImmutability.integration.test.ts` | §4a trigger rejects a raw `UPDATE` changing `type`/`observationGrain`/`memberPeriodRollup` on an existing `Metric` |
| `metricGrainWriterDefaults.integration.test.ts` | §8's `createMetric` explicitly sets `PERIOD_VALUE + LATEST` on a create with no grain/rollup input — proving the application, not the database default, is the source of the value |
| `metricResolutionCreateRequiresExplicitGrain.integration.test.ts` | §8's `metricResolution.ts` `create` disposition rejects a request missing `observationGrain`/`memberPeriodRollup` outright, and creates the metric with exactly the caller-supplied values when present — never a silent fallback; both the single- and multi-period wire paths are covered |
| `classifyTargetsGrainCollision.test.ts` (unit, not integration — `classifyTargets` is pure) | A `create` target whose name matches an existing library metric downgrades to reuse only when the selection's `observationGrain`/`memberPeriodRollup` matches the existing metric's actual values; a mismatch produces the distinguishable `grainConflict` outcome rather than silently attaching under the wrong contract |
| `validateColumnTargetsObservedOn.test.ts` (unit, not integration — `validateColumnTargets` is pure) | A `DAILY_OBSERVATION`-grain mapping missing `observedOn`, or with a malformed date string, is rejected; a `PERIOD_VALUE`-grain mapping carrying a stray `observedOn` is also rejected; a well-formed `observedOn` on a daily mapping passes through unchanged; an `existing`/`attach` target resolved from the archived-but-attached grain lookup (not the active-library one) is validated identically for both grains |
| `metricImportObservedOnRangeAndTimezone.integration.test.ts` | An import-path `observedOn` outside the destination period's `[startsAt, endsAt]` fails with the action's own pre-check message before ever reaching §4's trigger; a round-tripped `observedOn` reads back as the exact calendar date supplied regardless of the server process's `TZ` environment variable |
| `metricPeriodBoundaryImmutability.integration.test.ts` | §4b trigger rejects a boundary `UPDATE` once a `DAILY_OBSERVATION` entry exists; boundary edits remain unrestricted before that |
| `metricPeriodBoundaryInsertRace.integration.test.ts` | Two-session regression for §4c's `FOR SHARE` fix: open a daily-observation `INSERT` in session A (holding the lock before committing), attempt a concurrent boundary `UPDATE` in session B and prove it blocks rather than succeeding against stale data; repeat with the ordering reversed (B's boundary `UPDATE` first, A's `INSERT` blocks and then correctly fails once B's new, narrower boundaries are visible) |
| `metricPeriodBoundaryInsertRaceMultiPeriod.integration.test.ts` | Two multi-period-import transactions holding `FOR SHARE` on the same two periods in opposite acquisition orders both commit without deadlocking; a boundary `UPDATE` on either period blocks while either import transaction is still open, matching the single-period case |
| `metricPeriodAllianceLockOrdering.integration.test.ts` | Two parts, both against the **same** `MetricPeriod` row and the **same** `Alliance` row (using different periods, as an earlier draft of this test did, would let the two transactions serialize purely on `Alliance` without ever contending on `MetricPeriod`, so a writer that reversed the order would still pass). **(a) Regression baseline:** the real `record/action.ts` insert (`observedOn` = day 4 of a day-1-to-day-7 period) and the real `periods/action.ts` boundary edit narrowing the period to days 5–7 — a range that **deliberately excludes** the inserted date — run concurrently against the same period. That exclusion is pinned on purpose: a boundary edit whose new range still contained the inserted date would let both legitimately commit (4c's revalidation would simply pass), which is correct Postgres behavior but not what this regression is for, so the fixture must not leave that case ambiguous. With the exclusion, exactly one commit is correct for either acquisition order — never both, and never a hang: if the insert wins the `MetricPeriod` lock first, it commits and the boundary edit is then rejected once 4b's `EXISTS` check sees that now-committed daily entry; if the boundary edit wins first, it commits and the insert is then rejected once 4c revalidates `observedOn` against the new, narrower range that no longer contains it. The test asserts no deadlock/hang plus exactly one commit for both acquisition orders. **(b) Hazard canary, raw SQL:** two manually-sequenced sessions simulate the two lock *orderings* directly — one holds `MetricPeriod`'s lock and then requests `Alliance`'s, the other is deliberately driven `Alliance`-then-`MetricPeriod` (the order this design forbids) — and asserts Postgres's deadlock detector aborts one of them. (b) targets the `Alliance`-ordering hazard this section exists to rule out; (a) targets the separate, already-documented 4b/4c business-rule serialization that a same-period test surfaces as a side effect |
| `memberMetricEntryDailyValidation.integration.test.ts` | §4c trigger rejects a daily entry when either period boundary is null, and when `observedOn` falls outside `[startsAt, endsAt]` |
| `memberMetricEntryImmutable.integration.test.ts` | §4d trigger rejects a raw `UPDATE` to any field of an existing `MemberMetricEntry` row, including one that would otherwise move `observedOn`/`periodId` into an out-of-range combination |
| `memberMetricEntryGrainFk.integration.test.ts` | §3d composite FK rejects an entry whose `observationGrain` doesn't match its metric's actual grain |
| `memberMetricEntryStatusValueCheck.integration.test.ts` | §3b CHECK rejects `(ACTIVE, NULL)` and `(VOIDED, non-NULL)`; accepts the two valid combinations |
| `metricBooleanDailyRejection.integration.test.ts` | §3a CHECK rejects a `BOOLEAN`-type metric configured with `DAILY_OBSERVATION` |
| `memberPeriodRollupAlgebra.integration.test.ts` | ADR-018's rollup algebra worked cases: Tuesday-then-Friday-then-Saturday-correction resolves `LATEST` to Friday; a voided date is excluded from both `SUM` and `AVERAGE`'s denominator; zero active slots produces `NULL` under all three rollup kinds |
| `memberMetricEntryCorrectionConcurrency.integration.test.ts` | Same-day correction collapses to one slot; a concurrent correction-vs-void race resolves to one deterministic winner via `(recordedAt, createdAt, id)` |
| `legacyMetricParity.integration.test.ts` | For a representative pre-Phase-1 dataset, the canonical read model's output is byte-for-byte identical to the old per-consumer "latest wins" queries' output — the actual evidence behind §5's "no behavior change" claim |
| `metricObservationDeploymentWindow.integration.test.ts` | Simulates §1's deploy window directly: after Phase 1's migration runs (defaults present), an `INSERT` that omits `observationGrain`/`memberPeriodRollup`/`MemberMetricEntry.observationGrain` still succeeds via the default — proving Phase 1 alone is safe for old code — and only fails once the Phase 3 migration (defaults dropped) has also run |
| `voidCorrectionMutationAuthAndCache.integration.test.ts` | The correction/void mutation fails closed for a user lacking `IMPORT_METRICS` and for a slot outside the acting alliance; a successful mutation invalidates `members`, `dashboard`, `setup`, `evaluation-results`, and `reports` |
| `memberPeriodRollupTenantIsolationAndPerformance.integration.test.ts` | Tenant isolation (a query scoped to alliance A never returns alliance B's rows even with colliding ids) and representative row-volume performance for the canonical read model |

## 8. Exhaustive writer and consumer inventory

Fresh as of this design (`rg -n 'memberMetricEntry\.|"MemberMetricEntry"|metricEntries' app`, then read each match in context) — **more complete than ADR-018's own inventory**, which this table supersedes as the current source of truth. This is itself evidence for ADR-018 §6's point that a hand-maintained list drifts; this table is the concrete instance of the "implementation-time exhaustive checklist" that section requires, produced now rather than deferred.

**`MemberMetricEntry` writers** (need `observationGrain` + grain-aware `observedOn`/`status` handling; all three currently `createMany({ allianceMemberId, periodId, metricId, value })` with no grain awareness):

| File:line | Path |
|---|---|
| [`record/action.ts:97`](<../../app/alliances/[allianceId]/periods/[periodId]/record/action.ts#L97>) | Manual recording |
| [`import/action.ts:184`](<../../app/alliances/[allianceId]/periods/[periodId]/import/action.ts#L184>) | Single-period import |
| [`multiPeriodAction.ts:226`](<../../app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction.ts#L226>) | Multi-period import |

`record/action.ts` has a leader typing into a form for one specific day, so its `observedOn` source is unambiguous once the daily-recording UI exists (Implementation, not this design). The two importers are the real gap: ADR-018 §4 requires `observedOn` to be "supplied by the leader or the importer, never inferred from server 'now,'" but neither import pipeline has anywhere to put a date today — [`MetricImportEntry`](<../../app/src/lib/metricImport.ts#L14>) carries only `memberId`/`value`, and nothing upstream of it collects one either. Reproducing the reviewer's case makes this concrete: select `DAILY_OBSERVATION + SUM` for an imported metric, and both import plans have no field to put a date in — the implementation would have to either fail closed everywhere (acceptable, but not yet specified) or invent a date (which ADR-018 already forbids). This design has to make the actual decision, not just note the gap:

**Decision: `observedOn` is a property of the column mapping, not the entry or the whole import.** A spreadsheet column is the natural unit here — for a daily metric, one column represents one calendar day's values across every member, exactly how a `PERIOD_VALUE` column already represents one period's values across every member. Per-entry dates would imply one row could carry a different day than its neighbors in the same column, which nothing in the product (or the spreadsheet format) supports; per-import dates would prevent a single import from ever supplying more than one day, which defeats importing a week of daily data at once. Concretely:

- [`ColumnTargetMapping`](<../../app/src/lib/metricImport.ts#L26>) and [`ValidatedColumnTargetMapping`](<../../app/src/lib/metricImport.ts#L55>) — the shared pure-logic types [`multiPeriodImport.ts`](<../../app/src/lib/import/multiPeriodImport.ts>) already reuses directly rather than duplicating — grow one field: `observedOn?: string` (`YYYY-MM-DD`). Because both importers already share these types and [`validateColumnTargets`](<../../app/src/lib/metricImport.ts#L155>), this part of the fix is genuinely one change, unlike the grain selector in the section below.
- [`validateColumnTargets`](<../../app/src/lib/metricImport.ts#L155>) must reject a mapping outright — before anything is persisted — when the resolved target's grain is `DAILY_OBSERVATION` and `observedOn` is missing or not a well-formed calendar date, *and* when the grain is `PERIOD_VALUE` and `observedOn` is present (a stray date on a period-value column is rejected, not silently dropped, matching this function's existing all-or-nothing validation style). For a `create` target the grain is already on the wire (the previous finding's fix); for `existing`/`attach` targets the caller must resolve the already-configured metric's grain first.
- **The grain lookup for `existing`/`attach` targets must not be limited to the active library.** Both action files' [`libraryMetrics` query](<../../app/alliances/[allianceId]/periods/[periodId]/import/action.ts#L71>) filters `active: true`, but the very next comment in that file explains why an `existing`/`attach` target can legitimately reference an *archived* metric that's still attached to the period — [`assertImportMetricTargetBelongsToAlliance`](<../../app/src/lib/metricImport.ts#L37>) already accepts either `libraryMetricIds` **or** `attachedMetricIds` for exactly this reason. An archived-attached metric is absent from `libraryMetrics` entirely, so extending only that query (as the grain-collision fix above does) leaves the validator unable to decide whether `observedOn` is required or forbidden for that target — it would have no grain to check against at all. The `periodMetrics`/`attachedMetricIds` query must therefore also carry grain: select `observationGrain`/`memberPeriodRollup` through `MetricPeriodMetric`'s `metric` relation (a relation traversal, not a second unfiltered `Metric` query — consistent with the Prisma Philosophy's preference for relations), independent of that metric's `active` flag. The authoritative grain-by-id map `validateColumnTargets` receives is the union of both queries' results, not just the active-library one.
- **Both importers still need their own UI control**, matching the grain-selector precedent: [`ColumnTranslationCard.tsx`](<../../app/src/components/spreadsheet/ColumnTranslationCard.tsx>) and `MultiPeriodImportFlow.tsx`'s independent configuration UI each need a date picker that appears once a column's resolved-or-selected target is `DAILY_OBSERVATION`, and each flow's own wire-serialization step must carry the picked value onto `ColumnTargetMapping.observedOn`.
- **Parsing must not shift the date.** The picked `YYYY-MM-DD` string must be decomposed into its numeric year/month/day and constructed as explicit UTC midnight (`new Date(Date.UTC(year, month - 1, day))`), never `new Date(rawString)` handled generically — ADR-018 §4's "never shifted by a day" contract applies to the import path exactly as much as to a direct write.
- Out-of-period-range dates are still authoritatively rejected by §4's `member_metric_entry_validate_daily_observation` trigger, but the importer should fail with a clear, actionable message before reaching the database — both action files already load the destination period's boundaries, so this is a pre-check against data already in hand, not a second query.

This repository already has a general-purpose date-header parser ([`dateHeaderParser.ts`](<../../app/src/lib/import/dateHeaderParser.ts>)), but it is wired today to *period-boundary proposal* during multi-period import ([`periodProposal.ts`](<../../app/src/lib/import/periodProposal.ts>)), not to per-column observation dates, and repurposing it to pre-fill a daily column's date picker from its header text (e.g. a column literally named "8/4") is a reasonable future enhancement — **not** part of this design's required contract. If it is ever built, it must still populate the picker as a confirmable suggestion, never as a silent value, or it would reintroduce exactly the "inferred, not supplied" failure mode this section exists to close.

**`Metric` writers** (need `observationGrain` + `memberPeriodRollup` supplied explicitly — the exact same "every writer" requirement §1 makes for `MemberMetricEntry` applies here too, and this design's original inventory missed both):

| File:line | Path | Phase 1 contract |
|---|---|---|
| [`metrics/action.ts:135`](<../../app/alliances/[allianceId]/metrics/action.ts#L135>) | `createMetric` — the leader-facing "new metric" form | Today this action never accepts grain/rollup (the form has no such fields yet). Building the leader-facing daily-metric-configuration UI (letting a leader actually choose `DAILY_OBSERVATION`/`SUM`/`AVERAGE` when creating a metric) is a separate, later implementation PR, not this migration's job. For Phase 1, this action must be changed to *explicitly* pass `observationGrain: 'PERIOD_VALUE', memberPeriodRollup: 'LATEST'` in its `tx.metric.create` call — matching the only semantics the current form can express — rather than silently relying on the schema default. This keeps the action correct through Phase 3 (once the default is dropped) without requiring the new UI to exist yet |
| [`metricResolution.ts:192`](<../../app/src/lib/metricResolution.ts#L192>) | The spreadsheet importer's auto-create-on-unmatched-column path (`tx.metric.upsert(...)`) | Cannot hardcode a grain the way `createMetric` does — see below |

`metricResolution.ts`'s `create` path is not the same case as `createMetric` above, and a corrected version of the previous draft's answer here (hardcoding `PERIOD_VALUE + LATEST` explicitly in TypeScript instead of via the database default) is still wrong for the same reason ADR-018 §1 already names: **"an importer must never silently create a metric with a guessed grain."** Writing the guess in application code instead of a column default does not make it a selection — no leader ever saw or chose a grain for that specific metric.

The importer already has real leader-confirmation surfaces for exactly this decision, so the fix is to use them rather than invent a new one — but there are **two independent** such surfaces, not one, and the type carrying the selection is discarded partway through today's resolution pipeline. All of the following must change together, in the same implementation PR, or the fix is incomplete in exactly the ways it looks incomplete today:

- **Both import UIs, not just one.** Single-period import's [`ColumnTranslationCard.tsx`](<../../app/src/components/spreadsheet/ColumnTranslationCard.tsx>) is where a leader explicitly picks **"Create new metric"** from a dropdown for an unmatched column (`canCreateMetrics`-gated, already requiring `CONFIGURE_METRICS`). Multi-period import has its own, independent configuration UI and its own `ColumnTarget → ImportMetricTarget` serializer ([`MultiPeriodImportFlow.tsx`'s `toWireTarget`](<../../app/src/components/spreadsheet/MultiPeriodImportFlow.tsx#L445>)) — changing `ColumnTranslationCard` alone does not touch this second code path at all. Both need the same small addition: a grain selector that appears once "create" is chosen (with a rollup selector appearing only if `DAILY_OBSERVATION` is picked), and both `toWireTarget`-equivalents must carry the selection onto the wire.
- **The wire types.** `ColumnTarget`'s `create` variant ([`importTranslation.ts:7`](<../../app/src/lib/importTranslation.ts#L7>)) and `ImportMetricTarget`'s `create` variant ([`metricResolution.ts:24`](<../../app/src/lib/metricResolution.ts#L24>)) must both grow `observationGrain`/`memberPeriodRollup` fields.
- **`ClassifiedTarget` currently discards the selection — this is the actual break, not just a missing field.** [`ClassifiedTarget`](<../../app/src/lib/metricResolution.ts#L33>) only carries `disposition`/`metricId`/`createName`. [`classifyTargets`](<../../app/src/lib/metricResolution.ts#L65>)'s `create` branch returns `{ disposition: "create", metricId: null, createName: target.name }` — it never reads, let alone forwards, anything from `target` beyond the name. Extending the wire type without extending `ClassifiedTarget` and `classifyTargets` to carry `observationGrain`/`memberPeriodRollup` through is a design that silently drops the leader's selection before `resolveMetricTargets` ever sees it — exactly the failure mode this review caught. `resolveMetricTargets`' `create` branch must then read these fields off `item` (not off any default) and pass them to `tx.metric.upsert`'s `create` payload, rejecting the request if either is missing.
- **Name-collision reconciliation must check the grain, not just the name.** `classifyTargets`' existing "create intent: reuse an existing library metric if the name matches" branch ([`metricResolution.ts:93-101`](<../../app/src/lib/metricResolution.ts#L93-L101>)) silently downgrades a `create` to `existing`/`attach` whenever a same-named library metric exists — today that is safe because there is nothing to disagree about, but once `create` carries a leader-selected grain/rollup, this reuse must first compare that selection against the existing metric's *actual, immutable* `observationGrain`/`memberPeriodRollup` (so `LibraryMetric` must grow those two columns, sourced from the same `prisma.metric.findMany` both callers already run). A match reuses exactly as today. A mismatch must **not** silently attach entries under a different contract than the leader chose — `classifyTargets` needs a distinguishable outcome (e.g. a `disposition: "grainConflict"` carrying the existing metric's actual grain/rollup) that the caller turns into an explicit, actionable error before any write happens: rename the new metric, or select the existing one and accept its real semantics.

This is Implementation-phase work, not this design's deliverable (this design fixes the schema/migration contract, not the import UI or the resolution pipeline's internals), but the full chain above — both UIs, both wire types, `ClassifiedTarget`, `classifyTargets`' pass-through, `resolveMetricTargets`' required-field read, and the grain-aware collision check — is required, named Phase 1 scope for whichever implementation PR touches this writer, not something that can ship partially and rely on the rest arriving later.

`createMetric`'s test still applies as written — `metricGrainWriterDefaults.integration.test.ts` proves it explicitly sets `PERIOD_VALUE + LATEST` without relying on the database default. `metricResolution.ts`'s create path instead needs `metricResolutionCreateRequiresExplicitGrain.integration.test.ts`: a `create` disposition missing `observationGrain`/`memberPeriodRollup` is rejected outright, and one supplying them explicitly creates the metric with exactly those values — never a silent fallback either way.

**Semantic value/report consumers** (migrate to §6's canonical read model):

| File:line | Query |
|---|---|
| `getMetricSummaryReport.ts:272, 347, 400` | `queryAggregate`, `queryVisualizationRows`, `buildRosterCte` |
| `getAlliancePerformanceReport.ts:271` | alliance performance report |
| `getAllianceMemberMetricMatrix.ts:94, 194` | roster CTE and cell-value query |
| `apsDataReadinessAudit.ts:307, 406` | `queryCoverageAndDistribution`, `queryPeriodsWithValidDataCounts` |
| `members/page.tsx:124` | unbounded in-memory `latestMetricValueByMemberAndMetric` reduction |
| `members/[memberId]/page.tsx:81` | loads all period entries, keeps two |

Eight SQL implementations plus two JS-side reductions — matches ADR-018 §6's corrected count exactly.

**Coverage/setup consumers** (must count active resolved slots, not raw rows/`EXISTS`) — **this design surfaces four instances ADR-018 does not yet name across the two tables below**, marked "(new)":

| File:line | Query |
|---|---|
| `getPeriodResultsSummary.ts:65` | `groupBy(["allianceMemberId","metricId"])` |
| `allianceSetup.ts:124, 267` | setup-checklist count, `targetEntriesCount` |
| `betaParticipants.ts:438, 471` | `has_target_period_data`, second `EXISTS` feeding `is_complete` |
| `platform/setup.ts:50` | `alliancesWithData` funnel count |
| `platform/setup.ts:143` (new) | `getStalledAlliances`'s `none: { metricEntries: { some: {} } }` |
| `platform/alliances.ts:112–151` | `hasData` readiness check |
| `betaDashboard.ts:121` | `alliancesWithData` funnel count (duplicate of `platform/setup.ts:50`) |
| `betaDashboard.ts:158–173` (new) | `getAllianceReadiness`'s `hasData` (duplicate of `platform/alliances.ts`) |
| `betaDashboard.ts:202` (new) | `getNeedsAttention`'s "stuck alliances" `none: {...}` (duplicate of `platform/setup.ts:143`) |

**Audit/activity consumers** (keep reading raw events; must label `VOIDED` explicitly rather than presenting every row as positive activity):

| File:line | Query |
|---|---|
| `platform/activity.ts:188` | platform-wide "data imported" activity feed |
| `platform/alliances.ts:85, 113–163` | `activeToday`-style check, `lastMemberActivity` |
| `platform/alliances.ts:270–320` (new) | `getAllianceTimeline`'s "first dataset imported"/"last activity" support drill-down |
| `betaDashboard.ts:74, 264–281` | `activeToday` check, `recentEntries` activity feed |

**Dependency/cleanup logic** (retains all historical rows including voids unchanged — a void is just another row to these paths):

| File:line | Query |
|---|---|
| `rollbackPreview.ts:261` | import-rollback protected-dependency count (a void still represents history that must not be silently discarded by a revert) |
| `betaCleanup.ts` / `betaCleanupDb.ts` | beta-environment cleanup tooling |

Test fixture writers (`apsAuditFixtures.ts`, and any future test builders) also need explicit `observationGrain`/`status` once the Phase 1 schema lands, so integration tests keep constructing realistic rows rather than relying on defaults the way old production code temporarily does.

## Non-goals of this design

- Re-litigating any ADR-018 domain decision — this design implements what ADR-018 already decided.
- The Implementation-phase read-model TypeScript/Prisma query-builder code itself (§6 is the required shape, not the final module).
- UI for the daily-ledger drill-down or the correction/void interaction (Implementation, per ADR-018's own non-goals).
- APS/ADR-017 integration (blocked on ADR-018 §8, unaffected by this design).

## Related work

- [ADR-018](../adr/018-metric-observation-rollup-domain-model.md) — the domain model this design implements; amended and promoted to Accepted in this same PR, once §1's expand/contract correction is applied to its own text.
- [ADR-011](../adr/011-continuous-delivery.md) — the deployment pipeline §1's expand/contract analysis is built around.
- [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287) — the issue this design and ADR-018 both resolve.
- [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285) — the real-Postgres integration-test precedent §7 follows.
