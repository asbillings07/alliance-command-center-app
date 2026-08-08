# ADR-018: Metric Observation Grain and Member-Period Rollups

**Status:** Proposed

**Date:** 2026-08-08

## Context

Beta feedback on [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287) surfaced a real leadership workflow ACC cannot represent today: a founder tracks **daily** VS performance because a weekly total can hide meaningful inactivity — a member can score `0` for two days and still clear the weekly minimum on the strength of the remaining days, silently shifting workload onto the rest of the alliance. Leaders want the daily evidence retained (for coaching, consistency review, and eventual requirement evaluation under [#293](https://github.com/asbillings07/alliance-command-center-app/issues/293)) without manually re-entering a redundant weekly total ACC could derive itself.

Today, `Metric.summaryKind` (`SUM`/`AVERAGE`/`TRUE_RATE`/`NONE`) rolls values up **across members** for a period, but only ever looks at each member's single *latest* `MemberMetricEntry` — every consumer independently implements the same `DISTINCT ON ("allianceMemberId") ... ORDER BY "recordedAt" DESC` pattern (e.g. [`getMetricSummaryReport.ts`](app/src/lib/reports/getMetricSummaryReport.ts)) to get there. This collapses two conceptually distinct layers into one: "what did this member report on this day" and "what does the alliance's period total look like," with no room in between for "what is this member's own period total, derived from several dated observations." This ADR defines that missing middle layer and extends [ADR-008](008-spreadsheet-import-domain-model.md)'s source-data philosophy to it.

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

Every existing metric backfills to `PERIOD_VALUE + LATEST` via column default — zero behavior change, zero data migration. A newly created metric must select both fields explicitly; an importer must never silently create a metric with a guessed grain.

**Immutability is database-enforced, not application-only.** `type`, `observationGrain`, and `memberPeriodRollup` are creation-time immutable for every metric. Unlike the existing `type` precedent — which is immutable only because the edit action never includes it in its update payload ([`metrics/action.ts:201`](<../../app/alliances/[allianceId]/metrics/action.ts:201>)) — these three fields are protected by a database trigger that rejects any `UPDATE` changing any of them after creation, regardless of what application code attempts. A raw migration script, admin tool, or future bug touching the row directly must be unable to flip `SUM` to `AVERAGE` and silently reinterpret a metric's entire history. This is a deliberately stronger guarantee than the app-only `type` precedent, not a repetition of it.

### 2. Canonical slot identity, correction, and void semantics

The unit of a "day's answer" for one member on one metric in one period is the slot `(periodId, metricId, allianceMemberId, observedOn)`. Every "latest wins" query's partition key must include `metricId` explicitly — it is never safe to assume an enclosing `WHERE metricId = ...` narrows an otherwise metric-unaware `DISTINCT ON`.

- `MemberMetricEntry` gains `status` (`ACTIVE | VOIDED`, default `ACTIVE`) and `value` becomes **nullable**, with a DB CHECK enforcing the state machine: `(status = 'ACTIVE' AND value IS NOT NULL) OR (status = 'VOIDED' AND value IS NULL)`. A void never carries a fabricated value such as `0` — that would contradict the existing missing-vs-zero principle.
- **Voiding an observation appends a new `VOIDED` row for the same slot; it never deletes or updates an existing row**, preserving ADR-004's append-only guarantee. This extends the existing "latest wins" mechanism rather than replacing it: whichever row is latest for a slot wins, and if that row is `VOIDED`, the slot contributes nothing to `SUM`/`AVERAGE`/`LATEST` — equivalent to "no observation" for rollup purposes, while remaining visible in drill-down history as an explicit void rather than a silent gap.
- **Reactivation needs no special mechanism.** A later `ACTIVE` row for the same slot naturally becomes the new latest and supersedes a prior void — this falls directly out of "latest wins."
- Rejected alternative: an explicit supersession-lineage chain (`supersedesId` self-FK). It duplicates what `recordedAt`-ordered "latest wins" already does implicitly and requires recursive-CTE reads everywhere a tombstone status does not.
- `(recordedAt, createdAt, id)` is **deterministic tie-break precedence for choosing one winner per slot**, not a claim about true commit or wall-clock order — `id` is the final tiebreaker precisely because the other two can coincide. No production write path accepts a caller-supplied `recordedAt` today (only test fixtures do); this ADR makes that an explicit non-goal going forward. `observedOn` (source-declared, describes reality) and `recordedAt`/`createdAt` (server-generated, describe when ACC learned about it) are two independent concepts and must stay that way.

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

ADR-018 names a single read model — `memberPeriodMetricValues(allianceId, periodId, metricIds)` — returning per (member, metric): the derived value, `observationCount`, `lastObservedOn`, the provenance label from §5, and a handle for drill-down into the full dated ledger. Every "latest wins" query in the codebase is classified into exactly one of four categories, **per query, not per file**, since a single file can contain queries in different categories:

- **Semantic value/report consumers** — must migrate to the canonical rollup: `getMetricSummaryReport.ts`'s `queryAggregate`, `queryVisualizationRows`, and `buildRosterCte` (three independent `latest` CTEs in one file); `getAlliancePerformanceReport.ts` and `getAllianceMemberMetricMatrix.ts` (their own independent CTEs); `members/page.tsx`'s unbounded in-memory reduction (`latestMetricValueByMemberAndMetric`, loading every entry for the whole roster × all period metrics into JS); `members/[memberId]/page.tsx`, which needs to become a bounded, paginated daily-ledger query instead of loading all period entries to keep two; and `apsDataReadinessAudit.ts`'s `queryCoverageAndDistribution` — a fifth independent `latest` CTE, already-merged production code from [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285), whose coverage/distribution statistics must be computed **from the canonical member-period rollup values**, not from raw rows with voids merely filtered out, since a `DAILY_OBSERVATION+SUM` alliance's distribution should reflect summed period values, not per-day raw entries.
- **Coverage/setup consumers** — must count **active resolved slots**, not raw rows: `getPeriodResultsSummary.ts`'s `groupBy(["allianceMemberId","metricId"])` (today counts any row, so a member with only a latest-`VOIDED` slot would incorrectly appear as participating); `allianceSetup.ts`'s `memberMetricEntry.count(...)` setup-checklist signal; `betaParticipants.ts`'s `has_target_period_data` `EXISTS` check (same raw-existence defect); and `platform/alliances.ts`'s `hasData`/readiness check (`_count.metricEntries > 0`). All four incorrectly treat an all-voided slot set as "data present" today.
- **Audit/activity consumers** — intentionally read immutable raw events, but must label status explicitly rather than treating every row as positive activity: `platform/activity.ts`, and `platform/alliances.ts`'s separate recent-activity query (`lastMemberActivity`, derived from `recordedAt`) — distinct from that same file's readiness query above, which belongs in coverage/setup. These may keep showing "recorded," "voided," or "reactivated" accurately rather than switching to the canonical rollup.
- **Dependency/cleanup logic** — retains all historical rows including voids unchanged (import rollback, `betaCleanupDb.ts`); a void is just another row to these paths.

Consequences include a new index shaped for the `(periodId, metricId, allianceMemberId, observedOn)` correction lookup, and a requirement that the daily-ledger drill-down view be bounded/paginated by construction.

### 7. No mixed daily-derived and manual-period authority

One `Metric` has exactly one measurement contract — no tie-break rule between a derived daily rollup and a separately manually-reported period value for the same metric. If leadership needs both, they are two distinct metrics (e.g. `Daily VS` as `DAILY_OBSERVATION + SUM`, and `Weekly VS (reported)` as `PERIOD_VALUE + LATEST`), consistent with ADR-008's "calculated values are calculated, not imported alongside source data." ACC could later compare the two and flag a discrepancy, but that is future, explicitly out-of-scope work — neither metric silently wins over the other.

### 8. Relationship to ADR-017 and existing mutable-field debt

Once `observationGrain` and `memberPeriodRollup` exist, [ADR-017](017-alliance-performance-score-domain-model.md)'s §1 snapshot fields and configuration fingerprint must include them — **ADR-017 cannot move to Accepted until that's reflected**. This is a named cross-ADR dependency, not an implicit assumption.

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
- One canonical read model replaces (or is adopted by) five independent "latest wins" SQL implementations and one unbounded in-memory reduction; four coverage/setup queries switch from raw-row counts to active-resolved-slot counts; two activity queries gain explicit status labeling.
- `resolveComparablePeriod.ts` and everything downstream of `Metric.summaryKind` are unaffected — the alliance-level rollup contract does not change; it now consumes the member-period rollup instead of a bare latest value, with an identical output shape.

## Verification plan (acceptance bar)

Real-PostgreSQL tests, mirroring the [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285) precedent, must prove:

- Legacy-metric parity: existing `PERIOD_VALUE + LATEST` metrics behave identically before and after migration.
- Same-day correction collapses to one slot; voiding via the tombstone status with the `status`/`value` CHECK enforced; reactivation via a later `ACTIVE` row; a concurrent correction-vs-void race resolves to one deterministic winner.
- A raw `UPDATE` directly attempting to change `type`, `observationGrain`, or `memberPeriodRollup` on an existing `Metric` is rejected by the database trigger.
- The composite FK rejects a mismatched raw write (an entry claiming a grain that doesn't match its metric).
- An out-of-range `observedOn` fails closed; the both-boundaries-required-before-first-daily-entry rule and the resulting boundary immutability are enforced.
- A `BOOLEAN` metric is rejected from `DAILY_OBSERVATION` grain.
- Tenant isolation and representative row-volume performance for the canonical read model.

## Related work

- [ADR-008](008-spreadsheet-import-domain-model.md) — source-vs-calculated-data philosophy this ADR extends into intra-period observations.
- ADR-004 (see `AGENTS.md`) — append-only historical records, the basis for the tombstone-over-delete decision in §2.
- [ADR-017](017-alliance-performance-score-domain-model.md) — gated by this ADR per §8; must reflect `observationGrain`/`memberPeriodRollup` before Accepted.
- [#287](https://github.com/asbillings07/alliance-command-center-app/issues/287) — the beta feedback this ADR resolves.
- [#292](https://github.com/asbillings07/alliance-command-center-app/issues/292), [#293](https://github.com/asbillings07/alliance-command-center-app/issues/293), [#294](https://github.com/asbillings07/alliance-command-center-app/issues/294) — downstream consumers depending on this domain model being right before they build on it.
- [#190](https://github.com/asbillings07/alliance-command-center-app/issues/190) — the per-metric summary/`summaryKind` foundation this ADR leaves unchanged.
- [#285](https://github.com/asbillings07/alliance-command-center-app/pull/285) — the audit-tooling precedent for this ADR's real-Postgres verification bar.
