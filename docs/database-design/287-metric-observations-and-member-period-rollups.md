# Database Design: Metric Observations and Member-Period Rollups

**Issue:** [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287)

**Domain model:** [ADR-018](../adr/018-metric-observation-rollup-domain-model.md) (Proposed — this design's approval, specifically §1's deployment-safety gate, is what promotes it to Accepted)

**Date:** 2026-08-08

**First approval gate:** §1 (expand/contract deployment safety), before any other section is actionable.

---

## 1. Deployment safety analysis (the approval gate)

ADR-018's own Consequences section previously said the legacy backfill and the removal of its temporary defaults happen "in the same migration." That is unsafe under this project's actual deployment pipeline, and this design corrects it before anything else.

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

  // ADR-018 §1. Phase 1: @default(PERIOD_VALUE)/@default(LATEST) (temporary,
  // dropped in Phase 3 — see §1 of this design). Creation-time immutable,
  // enforced by the metric_reporting_fields_immutable_trigger in §4, not by
  // Prisma or the update action's payload shape.
  observationGrain   MetricObservationGrain
  memberPeriodRollup MemberPeriodRollupKind

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

  // ADR-018 §3. Phase 1: @default(PERIOD_VALUE) (temporary, dropped in
  // Phase 3). Written once at insert time from the metric's own grain;
  // the composite FK below is the actual guarantee that this copy can never
  // drift from Metric.observationGrain.
  observationGrain MetricObservationGrain
  metric           Metric @relation(fields: [metricId, observationGrain], references: [id, observationGrain])

  // ADR-018 §4. NOT NULL iff observationGrain = DAILY_OBSERVATION (CHECK in
  // §4), a source-declared YYYY-MM-DD civil date — see ADR-018 §4 for why
  // this is DATE, not DateTime.
  observedOn DateTime? @db.Date

  // ADR-018 §2. Permanent default — never dropped (contrast with the two
  // temporary defaults above).
  status MemberMetricEntryStatus @default(ACTIVE)

  // ADR-018 §2. Now nullable: a VOIDED row carries no value (CHECK in §4).
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

This is the first use of a database trigger in this codebase. All three are `BEFORE` triggers that `RAISE EXCEPTION` to reject the offending statement; none rewrite `NEW`.

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
    SELECT "startsAt", "endsAt" INTO period_starts_at, period_ends_at
    FROM "MetricPeriod" WHERE id = NEW."periodId";

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
  SELECT DISTINCT ON ("metricId", "allianceMemberId", "observedOn")
    "metricId", "allianceMemberId", "observedOn", "value", "status"
  FROM "MemberMetricEntry"
  WHERE "periodId" = $1 AND "metricId" = ANY($2) AND "allianceMember"."allianceId" = $3
  ORDER BY "metricId", "allianceMemberId", "observedOn", "recordedAt" DESC, "createdAt" DESC, "id" DESC
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
)
-- Final SELECT branches per Metric.memberPeriodRollup (LATEST vs. SUM vs.
-- AVERAGE) and LEFT JOINs so a member with zero active winning slots for a
-- metric still appears with a NULL derived value (ADR-018 §1's "zero active
-- slots" rule), never absent from the result set and never coerced to 0.
```

**Expected query plan:** the `slot_winner` CTE's `DISTINCT ON` is served by §2's new `(periodId, metricId, allianceMemberId, observedOn, recordedAt DESC, createdAt DESC, id DESC)` index — an index scan on the `periodId`/`metricId` predicate whose trailing key order exactly matches the `DISTINCT ON`'s `ORDER BY`, so Postgres needs no separate sort step, mirroring the reasoning already documented for the existing index. It is not an index-only scan (`value`/`status` are not in the index), so a heap fetch is still required per selected row — identical tradeoff to today's query.

`observationCount` and `lastObservedOn` (ADR-018 §5) are `active_slots`' `COUNT(*)`/`MAX("observedOn")` directly — never a raw row count, and never inflated by corrections or tombstones, since `slot_winner` already collapsed each slot to one row before `active_slots` filters to `ACTIVE`.

## 7. Real-Postgres test plan (concrete file list)

New `*.integration.test.ts` files (per the [`apsDataReadinessAudit.integration.test.ts`](../../app/src/lib/operations/apsDataReadinessAudit.integration.test.ts) precedent — `INTEGRATION_DB=true`, run via `npm run test:integration`), each proving one ADR-018 verification-plan bullet against a real database rather than a mocked Prisma client:

| Test file | Proves |
|---|---|
| `metricGrainImmutability.integration.test.ts` | §4a trigger rejects a raw `UPDATE` changing `type`/`observationGrain`/`memberPeriodRollup` on an existing `Metric` |
| `metricPeriodBoundaryImmutability.integration.test.ts` | §4b trigger rejects a boundary `UPDATE` once a `DAILY_OBSERVATION` entry exists; boundary edits remain unrestricted before that |
| `memberMetricEntryDailyValidation.integration.test.ts` | §4c trigger rejects a daily entry when either period boundary is null, and when `observedOn` falls outside `[startsAt, endsAt]` |
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

**Writers** (need `observationGrain` + grain-aware `observedOn`/`status` handling; all three currently `createMany({ allianceMemberId, periodId, metricId, value })` with no grain awareness):

| File:line | Path |
|---|---|
| [`record/action.ts:97`](<../../app/alliances/[allianceId]/periods/[periodId]/record/action.ts#L97>) | Manual recording |
| [`import/action.ts:184`](<../../app/alliances/[allianceId]/periods/[periodId]/import/action.ts#L184>) | Single-period import |
| [`multiPeriodAction.ts:226`](<../../app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction.ts#L226>) | Multi-period import |

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

- [ADR-018](../adr/018-metric-observation-rollup-domain-model.md) — the domain model this design implements; promoted to Accepted once §1 of this design is approved.
- [ADR-011](../adr/011-continuous-delivery.md) — the deployment pipeline §1's expand/contract analysis is built around.
- [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287) — the issue this design and ADR-018 both resolve.
- [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285) — the real-Postgres integration-test precedent §7 follows.
