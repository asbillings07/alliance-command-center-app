# ADR-018: Metric Observation Grain and Member-Period Rollups

**Status:** Proposed

**Date:** 2026-08-08

## Context

Beta feedback on [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287) surfaced a real leadership workflow ACC cannot represent today: a founder tracks **daily** VS performance because a weekly total can hide meaningful inactivity — a member can score `0` for two days and still clear the weekly minimum on the strength of the remaining days, silently shifting workload onto the rest of the alliance. Leaders want the daily evidence retained (for coaching, consistency review, and eventual requirement evaluation under [#293](https://github.com/asbillings07/alliance-command-center-app/issues/293)) without manually re-entering a redundant weekly total ACC could derive itself.

Today, `Metric.summaryKind` (`SUM`/`AVERAGE`/`TRUE_RATE`/`NONE`) rolls values up **across members** for a period, but only ever looks at each member's single *latest* `MemberMetricEntry` — every consumer independently implements the same `DISTINCT ON ("allianceMemberId") ... ORDER BY "recordedAt" DESC` pattern (e.g. [`getMetricSummaryReport.ts`](../../app/src/lib/reports/getMetricSummaryReport.ts)) to get there. This collapses two conceptually distinct layers into one: "what did this member report on this day" and "what does the alliance's period total look like," with no room in between for "what is this member's own period total, derived from several dated observations." This ADR defines that missing middle layer and extends [ADR-008](008-spreadsheet-import-domain-model.md)'s source-data philosophy to it.

## The three-layer model

| Layer | Meaning | Example |
|---|---|---|
| Source observation | Historical fact entered or imported, append-only | Dragon scored 12M on Tuesday |
| Member-period rollup | Derived from that member's own observations in the period | Weekly VS = `SUM(daily VS)` |
| Alliance summary | Existing `summaryKind` across members | Total or average weekly VS across the alliance |

Today's `MemberMetricEntry` table conflates the first two layers into "whatever the latest row happens to be." This ADR makes the middle layer explicit without changing what the top layer (`Metric.summaryKind`) means or does.

## Decision

### 1. `observationGrain` and `memberPeriodRollup`

Two new fields on `Metric`, orthogonal to the existing `summaryKind` (which stays exactly as-is — it still governs cross-member alliance rollup):

- `observationGrain`: `PERIOD_VALUE | DAILY_OBSERVATION`
- `memberPeriodRollup`: `LATEST | SUM | AVERAGE`

**Compatibility, enforced by a database CHECK constraint** mirroring the existing `metric_summary_kind_matches_type` pattern ([migration](../../prisma/migrations/20260801160620_metric_summary_kind/migration.sql)):

- `PERIOD_VALUE` → `LATEST` only.
- `DAILY_OBSERVATION` → `LATEST | SUM | AVERAGE`, and **restricted to `NUMERIC` metrics for v1**. A `BOOLEAN` metric stays `PERIOD_VALUE + LATEST` only: daily booleans `1, 1, 0` would produce `SUM = 2` or `AVERAGE = 0.667`, both invalid inputs to the existing `TRUE_RATE` alliance layer, which requires every member value to be exactly `0` or `1`. Daily boolean rollups are deferred until a concrete product case (e.g. a per-day check-in feeding a `TRUE_RATE`-of-days) justifies the added complexity with a worked example.

Every existing metric backfills to `PERIOD_VALUE + LATEST` via column default — no behavior-changing data migration (see "Legacy backfill" under Consequences for what that actually entails at the `MemberMetricEntry` level, not just on `Metric`). A newly created metric must select both fields explicitly; an importer must never silently create a metric with a guessed grain.

**Rollup algebra.** `memberPeriodRollup` combines a member's own dated slots for a period into one derived value. This is a two-phase computation, and the two phases must not be conflated:

- **Phase 1 — within-slot correction (§2)**: for each `(periodId, metricId, allianceMemberId, observedOn)` slot independently, `(recordedAt, createdAt, id)` DESC picks the one winning row. This resolves *which value* Tuesday has, not *whether* Tuesday counts more than Friday.
- **Phase 2 — across-slot rollup**: applied only to the member's **active** winning slots (voided/never-recorded dates excluded entirely, not treated as `0`):
  - **`LATEST`** — the value from the active winning slot with the greatest `observedOn`. Worked example: Tuesday is recorded first, Friday is recorded second, then a correction to Tuesday's value is written on Saturday. `LATEST` is still Friday's value — the Saturday write only changes which row wins *Tuesday's* slot in Phase 1; a backdated correction to an earlier date never displaces a later date's value in Phase 2. `LATEST` never means "most recently written row."
  - **`SUM`** — the sum of the active winning slots' values. A voided or missing date contributes nothing to the sum (not `0`).
  - **`AVERAGE`** — the mean of the active winning slots' values; a voided or missing date is excluded from the denominator as well as the numerator. Precision mirrors the existing cross-member `summaryKind = AVERAGE` contract exactly ([`getMetricSummaryReport.ts`](../../app/src/lib/reports/getMetricSummaryReport.ts) casts to `::float8`): unrounded double precision at the data layer; this ADR does not introduce a separate rounding contract, and display formatting applies ACC's existing rules.
  - **Zero active winning slots** — the member-period rollup is `NULL` for `LATEST`, `SUM`, and `AVERAGE` alike, never `0`. This is the same "missing observations are not zero" principle already established for the observation layer, applied uniformly to all three rollup kinds rather than only to `LATEST`.

**Immutability is database-enforced, not application-only.** `type`, `observationGrain`, and `memberPeriodRollup` are creation-time immutable for every metric. Unlike the existing `type` precedent — which is immutable only because the edit action never includes it in its update payload ([`metrics/action.ts`](<../../app/alliances/[allianceId]/metrics/action.ts#L201>)) — these three fields are protected by a database trigger that rejects any `UPDATE` changing any of them after creation, regardless of what application code attempts. A raw migration script, admin tool, or future bug touching the row directly must be unable to flip `SUM` to `AVERAGE` and silently reinterpret a metric's entire history. This is a deliberately stronger guarantee than the app-only `type` precedent, not a repetition of it.

### 2. Canonical slot identity, correction, and void semantics

The unit of a "day's answer" for one member on one metric in one period is the slot `(periodId, metricId, allianceMemberId, observedOn)`. Every "latest wins" query's partition key must include `metricId` explicitly — it is never safe to assume an enclosing `WHERE metricId = ...` narrows an otherwise metric-unaware `DISTINCT ON`.

- `MemberMetricEntry` gains `status` (`ACTIVE | VOIDED`, default `ACTIVE`) and `value` becomes **nullable**, with a DB CHECK enforcing the state machine: `(status = 'ACTIVE' AND value IS NOT NULL) OR (status = 'VOIDED' AND value IS NULL)`. A void never carries a fabricated value such as `0` — that would contradict the existing missing-vs-zero principle.
- **Voiding an observation appends a new `VOIDED` row for the same slot; it never deletes or updates an existing row**, preserving ADR-004's append-only guarantee. This extends the existing "latest wins" mechanism rather than replacing it: whichever row is latest for a slot wins, and if that row is `VOIDED`, the slot contributes nothing to `SUM`/`AVERAGE`/`LATEST` — equivalent to "no observation" for rollup purposes, while remaining visible in drill-down history as an explicit void rather than a silent gap.
- **Reactivation needs no special mechanism.** A later `ACTIVE` row for the same slot naturally becomes the new latest and supersedes a prior void — this falls directly out of "latest wins."
- Rejected alternative: an explicit supersession-lineage chain (`supersedesId` self-FK). It duplicates what `recordedAt`-ordered "latest wins" already does implicitly and requires recursive-CTE reads everywhere a tombstone status does not.
- `(recordedAt, createdAt, id)` is **deterministic tie-break precedence for choosing one winner per slot**, not a claim about true commit or wall-clock order — `id` is the final tiebreaker precisely because the other two can coincide. No production write path accepts a caller-supplied `recordedAt` today (only test fixtures do); this ADR makes that an explicit non-goal going forward. `observedOn` (source-declared, describes reality) and `recordedAt`/`createdAt` (server-generated, describe when ACC learned about it) are two independent concepts and must stay that way.

**The correction/void/reactivation mutation contract.** Appending a `VOIDED` or corrective `ACTIVE` row is a real, authorized server mutation, not a byproduct of accepting `observedOn` on the existing recording write paths. It must carry an equivalent authorization/scoping/transaction contract to `recordMemberMetrics` ([`record/action.ts`](<../../app/alliances/[allianceId]/periods/[periodId]/record/action.ts>)), with a wider cache-invalidation footprint than recording alone requires:

- **Authorization**: the same `Permissions.IMPORT_METRICS` permission as recording — for v1, correcting or voiding a metric observation is not a separate capability from recording one.
- **Tenant scoping**: the target period, metric, and member are re-verified against the acting `allianceId` via scoped lookups (`findFirst({ where: { id, allianceId } })`), exactly as `recordMemberMetrics` does — a slot id or member id is never trusted bare.
- **Transaction**: the tombstone/corrective insert and `touchAllianceSetupActivity` happen inside one `prisma.$transaction`, exactly as today's recording path.
- **Cache invalidation**: `revalidateAllianceData` domains are `members`, `dashboard`, `setup`, `evaluation-results`, and `reports` — matching the five-domain precedent the single-period [import action](<../../app/alliances/[allianceId]/periods/[periodId]/import/action.ts>) already uses, not `recordMemberMetrics`'s narrower three. A void or correction changes the per-member daily-ledger drill-down and the members grid (`members`, absent from `recordMemberMetrics`) and can change `getAllianceSetupStatus`'s completion signal, which feeds the alliance home page's `SetupProgressCard` (`dashboard`, also absent from `recordMemberMetrics`) — both read surfaces recording alone does not currently need to invalidate.

### 3. The grain snapshot is database-bound to the metric

`MemberMetricEntry` gets its own `observationGrain` column, written once at insert time from the metric's (creation-time-immutable) grain. A CHECK constraint alone can't prove this copy matches `Metric.observationGrain` — a CHECK can't join to another table. Instead:

- Add `UNIQUE (id, "observationGrain")` on `Metric` (redundant with its primary key alone, but required as a composite foreign-key target).
- Give `MemberMetricEntry` a composite foreign key: `FOREIGN KEY ("metricId", "observationGrain") REFERENCES "Metric"(id, "observationGrain")`.

Because `Metric.observationGrain` cannot change after creation (§1), this FK is a real database invariant: an entry's stamped grain always equals its metric's actual grain. A raw or faulty write can no longer mislabel a metric as daily merely to satisfy the entry-level `observedOn` NOT NULL check below. Application validation stays for friendly error messages; the FK is the actual guarantee.

`observedOn` is `NOT NULL` whenever `observationGrain = DAILY_OBSERVATION` and always `NULL` for `PERIOD_VALUE`, enforced by a DB CHECK on the entry.

### 4. Civil-date and period-boundary semantics

`observedOn` is a source-declared `YYYY-MM-DD` civil date, stored as a Postgres `DATE` — timezone-free by construction, not "UTC-normalized" (a `DATE` has no time component to convert in the first place). It is supplied by the leader or the importer, never inferred from server "now." When it passes through Prisma/JS it must never be shifted by a day; display follows the app's existing UTC-pinned formatting precedent ([`formatImportTimestamp.ts`](../../app/src/lib/format/formatImportTimestamp.ts)) rather than any local-timezone conversion. ACC does not introduce an alliance-configurable timezone — that remains out of scope.

`periodId` remains authoritative for period membership, exactly as today: an explicit FK chosen by the leader or importer. This ADR does not add a second "which period does this date belong to" resolution engine. `observedOn` must fall within `[MetricPeriod.startsAt, MetricPeriod.endsAt]`, validated at write time and failing closed (rejecting the write) when out of range.

**Both period boundaries are required before the first daily observation, not merely locked afterward.** A period may have null `startsAt`/`endsAt` today ([`periods/action.ts`](<../../app/alliances/[allianceId]/periods/action.ts>) permits this at creation and edit), and "immutable after first daily entry" alone would let such a period stay permanently undated forever. Instead: a period must already have both boundaries set before it can accept its first `DAILY_OBSERVATION`-grain entry, failing closed with a clear "set period dates first" error otherwise. Once that first daily entry exists, the boundaries become immutable — closing the gap in `editMetricPeriod`, which today allows unconditional boundary edits regardless of existing entries. This lock needs the same database-enforced treatment as §1's grain/rollup lock, not an application check-then-write.

### 5. Provenance, `observationCount`, and `lastObservedOn`

Provenance is a **static function of configuration**, never inferred from how many rows happen to exist:

| Configuration | Provenance |
|---|---|
| `PERIOD_VALUE + LATEST` | Source period value |
| `DAILY_OBSERVATION + LATEST` | Derived (latest observation) |
| `DAILY_OBSERVATION + SUM` | Derived (sum) |
| `DAILY_OBSERVATION + AVERAGE` | Derived (average) |

A `DAILY_OBSERVATION + SUM` metric with only Monday recorded still produces a *derived* rollup that happens to equal one number — it is not reclassified as a source value merely because only one observation contributed.

`observationCount` is the number of **ACTIVE winning slots after correction/void resolution** — one per `(periodId, metricId, allianceMemberId, observedOn)` that resolves to a non-voided latest row — never a raw row count. Corrections and tombstones must never inflate it. `lastObservedOn` is the latest `observedOn` among those same active winning slots. Display language is "N observation dates recorded," never "N of M days," which would imply an expected cadence only #293's future requirement layer is entitled to define.

### 6. One canonical read model; consumers classified per query

ADR-018 names a single read model — `memberPeriodMetricValues(allianceId, periodId, metricIds)` — returning per (member, metric): the derived value, `observationCount`, `lastObservedOn`, the provenance label from §5, and a handle for drill-down into the full dated ledger. Every "latest wins" query in the codebase is classified into exactly one of four categories, **per query, not per file**, since a single file can contain queries in different categories.

**Verified count, as of this writing** (`rg -n "DISTINCT ON"` across `app/src/lib/reports` and `app/src/lib/operations`): there are **eight** independent latest-value SQL implementations, not five — two files contain two apiece:

- **Semantic value/report consumers** — must migrate to the canonical rollup: `getMetricSummaryReport.ts`'s `queryAggregate`, `queryVisualizationRows`, and `buildRosterCte` (three independent `latest` CTEs in one file); `getAlliancePerformanceReport.ts` (one); `getAllianceMemberMetricMatrix.ts` — **two**, a roster CTE and a separate paginated cell-value query further down the same file; `members/page.tsx`'s unbounded in-memory reduction (`latestMetricValueByMemberAndMetric`, loading every entry for the whole roster × all period metrics into JS); `members/[memberId]/page.tsx`, which needs to become a bounded, paginated daily-ledger query instead of loading all period entries to keep two; and `apsDataReadinessAudit.ts` — **two**, `queryCoverageAndDistribution` and `queryPeriodsWithValidDataCounts`, already-merged production code from [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285), both of which must compute **from the canonical member-period rollup values**, not from raw rows with voids merely filtered out, since a `DAILY_OBSERVATION+SUM` alliance's distribution or dogfood-readiness signal should reflect summed period values, not per-day raw entries.
- **Coverage/setup consumers** — must count **active resolved slots**, not raw rows. Confirmed instances: `getPeriodResultsSummary.ts`'s `groupBy(["allianceMemberId","metricId"])`; `allianceSetup.ts` — **two** separate raw counts (the setup-checklist `metricEntries` count, and a second `targetEntriesCount` count gating `targetPeriodHasEntries`); `betaParticipants.ts` — **two** separate `EXISTS` checks (`has_target_period_data` and a second, structurally identical `EXISTS` feeding `is_complete`); `platform/setup.ts`'s `alliancesWithData` platform funnel count; `platform/alliances.ts`'s `hasData`/readiness check (`_count.metricEntries > 0`); and `betaDashboard.ts`'s own `alliancesWithData` funnel count (a second, independently-written copy of the same funnel query used by `platform/setup.ts`). Every one of these incorrectly treats an all-voided slot set as "data present" today.
- **Audit/activity consumers** — intentionally read immutable raw events, but must label status explicitly rather than treating every row as positive activity: `platform/activity.ts`; `platform/alliances.ts`'s separate recent-activity query (`lastMemberActivity`, derived from `recordedAt`) — distinct from that same file's readiness query above, which belongs in coverage/setup; and `betaDashboard.ts`'s `activeToday` alliance-activity check (also derived from `recordedAt`, and also distinct from that file's coverage/setup query above). These may keep showing "recorded," "voided," or "reactivated" accurately rather than switching to the canonical rollup.
- **Dependency/cleanup logic** — retains all historical rows including voids unchanged (import rollback, `betaCleanupDb.ts`); a void is just another row to these paths.

**This list is a snapshot, not a promise of completeness.** The list above already grew once during this ADR's own review (two unlisted "latest wins" SQL implementations and five unlisted coverage/setup/activity queries surfaced in a single review pass — seven query-level findings in total), which is itself evidence that a hand-maintained list will keep drifting before implementation lands. Accordingly, the first read-model implementation PR must include, as an acceptance gate rather than a documentation nicety: a fresh, complete, per-query classification of every `MemberMetricEntry` read in the tree at that time (e.g. via a repo-wide search such as `rg -n '"MemberMetricEntry"' app/` plus a search for the Prisma `memberMetricEntry` model accessor), with each hit assigned to one of the four categories above and either migrated to the canonical read model or explicitly justified as staying raw. This is the durable fix for list drift; the counts above are context, not the source of truth at implementation time.

Consequences include a new index shaped for the `(periodId, metricId, allianceMemberId, observedOn)` correction lookup, and a requirement that the daily-ledger drill-down view be bounded/paginated by construction.

### 7. No mixed daily-derived and manual-period authority

One `Metric` has exactly one measurement contract — no tie-break rule between a derived daily rollup and a separately manually-reported period value for the same metric. If leadership needs both, they are two distinct metrics (e.g. `Daily VS` as `DAILY_OBSERVATION + SUM`, and `Weekly VS (reported)` as `PERIOD_VALUE + LATEST`), consistent with ADR-008's "calculated values are calculated, not imported alongside source data." ACC could later compare the two and flag a discrepancy, but that is future, explicitly out-of-scope work — neither metric silently wins over the other.

### 8. Relationship to ADR-017 and existing mutable-field debt

Once `observationGrain` and `memberPeriodRollup` exist, ADR-017 (in progress, see [#284](https://github.com/asbillings07/alliance-command-center-app/issues/284))'s §1 snapshot fields and configuration fingerprint must include them — **ADR-017 cannot move to Accepted until that's reflected**. This is a named cross-ADR dependency, not an implicit assumption. ADR-017 is not yet committed to this repository; this reference is deliberately plain text, not a link, until it lands.

ADR-018's historical-integrity guarantee is scoped honestly: it covers only the new fields introduced here (`observationGrain`, `memberPeriodRollup`, `observedOn`, `status`) as database-enforced, creation-time immutable. It does **not** retroactively fix `Metric.summaryKind`/`unitLabel`/`trendDirection` mutability, which remains pre-existing historical-integrity debt (editable at any time regardless of period status, per [`metrics/action.ts`](<../../app/alliances/[allianceId]/metrics/action.ts>)). That gap becomes a **named release gate specifically blocking ADR-017/APS**: APS cannot be marked Accepted while those three fields remain live-mutable, since a live edit could reinterpret a historical score's meaning out from under it. The uniform rule going forward: fields that change numerical meaning, units, grain, or aggregation can never silently reinterpret recorded history; names and descriptions may remain freely editable.

## Non-goals

- Compliance thresholds, pass/fail evaluation, and repeated-failure pattern detection — all #293.
- Cross-metric discrepancy flagging between a derived daily rollup and a separately reported manual value.
- An alliance-configurable timezone concept.
- Daily-observation support for `BOOLEAN` metrics (deferred pending a concrete use case).
- UI design for the daily-ledger drill-down (an implementation-issue concern).
- Exact migration DDL and trigger implementation (implementation-issue detail; this ADR fixes the invariant, not the SQL).

## Consequences

- `Metric` gains `observationGrain`, `memberPeriodRollup` (both creation-time immutable, DB-trigger-enforced), a compatibility CHECK constraint, and a `UNIQUE(id, observationGrain)` index to support §3's composite FK.
- `MemberMetricEntry` gains `observedOn` (nullable `DATE`), `status` (`ACTIVE | VOIDED`, default `ACTIVE`), a status/value-nullability CHECK, a composite FK to `Metric` on `(metricId, observationGrain)`, and a new index shaped for `(periodId, metricId, allianceMemberId, observedOn)` correction lookups. `value` becomes nullable.
- `MetricPeriod` gains a database-enforced boundary lock once any `DAILY_OBSERVATION`-grain entry exists for that period, and a fail-closed "both boundaries required" check before accepting such an entry.
- Three write paths (`record/action.ts`, `periods/[periodId]/import/action.ts`, `multiPeriodAction.ts`) need an `observedOn` input and grain-aware validation.
- One canonical read model replaces (or is adopted by) the eight independent "latest wins" SQL implementations and one unbounded in-memory reduction confirmed in §6, plus whatever additional ones the implementation-time exhaustive checklist surfaces; confirmed coverage/setup queries switch from raw-row counts/`EXISTS` checks to active-resolved-slot counts; confirmed activity queries gain explicit status labeling.
- `resolveComparablePeriod.ts` and everything downstream of `Metric.summaryKind` are unaffected — the alliance-level rollup contract does not change; it now consumes the member-period rollup instead of a bare latest value, with an identical output shape.
- **Legacy backfill** (no behavior-changing data migration, not "zero data migration" — every existing row does receive a real column value): `Metric.observationGrain`/`memberPeriodRollup` and `MemberMetricEntry.observationGrain`/`status` are added as `NOT NULL` columns with constant defaults (`PERIOD_VALUE`/`LATEST`/`PERIOD_VALUE`/`ACTIVE` respectively) — Postgres backfills every existing row as part of adding the column when the default is a constant, a metadata-only operation with no separate `UPDATE` pass and no long-lived table lock. **Ordering matters and is part of this ADR's contract, not an implementation detail**: these default-backed columns are added first; the compatibility CHECK constraints and the `(metricId, observationGrain)` composite FK are added afterward, in the same migration. By the time the constraints are added, every existing row already satisfies them by construction of the defaults, so constraint validation is guaranteed to pass rather than merely expected to. Consistent with every other migration in this repo, no down-migration is authored; if the backfill or a constraint addition surfaces a problem, the fix is a forward migration, not a rollback. The actual evidence that this is behavior-preserving is the legacy-metric parity test below, not the defaults themselves.
- **The `PERIOD_VALUE`/`LATEST` defaults are migration-only and must be dropped from `Metric.observationGrain`, `Metric.memberPeriodRollup`, and `MemberMetricEntry.observationGrain` once the backfill completes** (a separate, immediate `ALTER COLUMN ... DROP DEFAULT` in the same migration, after the existing rows are populated). Leaving those three defaults in place would let a newly created metric omit `observationGrain`/`memberPeriodRollup` entirely and silently become `PERIOD_VALUE + LATEST`, directly contradicting §1's requirement that a new metric select both explicitly — the database would quietly reintroduce the exact "guessed grain" failure mode §1 rules out. `MemberMetricEntry.status`'s `ACTIVE` default is the one exception and stays permanently: unlike grain/rollup, "a newly recorded entry is active unless explicitly voided" is the correct default forever, not just during backfill.

## Verification plan (acceptance bar)

Real-PostgreSQL tests, mirroring the [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285) precedent, must prove:

- Legacy-metric parity: for a representative pre-migration dataset, the canonical read model's output is identical to the old per-consumer "latest wins" queries' output for existing `PERIOD_VALUE + LATEST` metrics — this is the actual evidence backing the backfill's "no behavior change" claim, not just the column defaults.
- Rollup algebra: a Tuesday-then-Friday-then-Saturday-correction-to-Tuesday sequence resolves `LATEST` to Friday's value, not Tuesday's; a `SUM`/`AVERAGE` case with one voided date excludes it from both the aggregate and `AVERAGE`'s denominator; a member with zero active winning slots produces `NULL` under `LATEST`, `SUM`, and `AVERAGE` alike.
- Same-day correction collapses to one slot; voiding via the tombstone status with the `status`/`value` CHECK enforced; reactivation via a later `ACTIVE` row; a concurrent correction-vs-void race resolves to one deterministic winner.
- A raw `UPDATE` directly attempting to change `type`, `observationGrain`, or `memberPeriodRollup` on an existing `Metric` is rejected by the database trigger.
- The composite FK rejects a mismatched raw write (an entry claiming a grain that doesn't match its metric).
- An out-of-range `observedOn` fails closed; the both-boundaries-required-before-first-daily-entry rule and the resulting boundary immutability are enforced.
- A `BOOLEAN` metric is rejected from `DAILY_OBSERVATION` grain.
- The correction/void mutation fails closed for a user lacking `IMPORT_METRICS`, and for a slot whose period/metric/member does not belong to the acting alliance; a successful void/correction invalidates the `members`, `dashboard`, `setup`, `evaluation-results`, and `reports` cache domains.
- Tenant isolation and representative row-volume performance for the canonical read model.

## Related work

- [ADR-008](008-spreadsheet-import-domain-model.md) — source-vs-calculated-data philosophy this ADR extends into intra-period observations.
- ADR-004 (see `AGENTS.md`) — append-only historical records, the basis for the tombstone-over-delete decision in §2.
- ADR-017 (in progress, see [#284](https://github.com/asbillings07/alliance-command-center-app/issues/284)) — gated by this ADR per §8; must reflect `observationGrain`/`memberPeriodRollup` before Accepted. Not yet committed, so referenced here as plain text rather than a link.
- [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287) — the beta feedback this ADR resolves.
- [#292](https://github.com/asbillings07/alliance-command-center-app/issues/292), [#293](https://github.com/asbillings07/alliance-command-center-app/issues/293), [#294](https://github.com/asbillings07/alliance-command-center-app/issues/294) — downstream consumers depending on this domain model being right before they build on it.
- [#190](https://github.com/asbillings07/alliance-command-center-app/issues/190) — the per-metric summary/`summaryKind` foundation this ADR leaves unchanged.
- [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285) — the audit-tooling precedent for this ADR's real-Postgres verification bar.
