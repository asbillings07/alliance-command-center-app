# #287 Slice 3 — Consumer Parity Diff Log

Executable acceptance record for migrating each "semantic value/report" and
"coverage/setup" consumer (per the [#287 database design](287-metric-observations-and-member-period-rollups.md)
§8 inventory) to the canonical read model, [`memberPeriodMetricValues`](../../app/src/lib/metrics/memberPeriodMetricValues.ts)
(ADR-018 §6). Each row below is backed by a real-Postgres integration test
that runs the consumer's previous implementation (reproduced verbatim, not
hand-described) and its new implementation against the same fixture, then
asserts the outcome. The tests are the source of truth; this table is a
human-readable index into them, not a substitute for reading them.

**Invariant:** for a legacy `PERIOD_VALUE + LATEST` scenario, parity must be
exact (`PASS`). A scenario may only be `EXPECTED_BREAKING` when the
divergence is an intentional correctness fix implied by ADR-018 itself
(never an incidental behavior change), and must carry an explicit
rationale plus confirmation that no writer produces the diverging
condition in production today.

**Exit criteria for a Slice 3 PR:** every parity test referenced below is
green, no scenario is left as an unaccounted `TODO`, and this table is
updated in the same PR that performs the migration.

---

## `getPeriodResultsSummary.ts`

- **Location:** `app/src/lib/reports/getPeriodResultsSummary.ts`
- **Old implementation:** `prisma.memberMetricEntry.groupBy(["allianceMemberId", "metricId"])` — participation derived from row *existence*.
- **New implementation:** `memberPeriodMetricValues(...)`, filtered to `observationCount > 0` — participation derived from active *winning slots*.
- **Test:** [`getPeriodResultsSummaryParity.integration.test.ts`](../../app/src/lib/reports/getPeriodResultsSummaryParity.integration.test.ts)

| Input scenario | Old result summary | New result summary | Match result |
|---|---|---|---|
| Single entry, one member, one `PERIOD_VALUE` metric | 1 participating member | 1 participating member | `PASS` |
| Three corrections (same member+metric, different `recordedAt`) | Collapses to 1 participating pair (`groupBy` dedupes by member+metric already) | Collapses to 1 participating pair (one winning slot) | `PASS` |
| No entry at all for a member | Not participating | Not participating | `PASS` |
| Three daily observations (same member, same `DAILY_OBSERVATION+SUM` metric, three dates) | Collapses to 1 participating pair (`groupBy` doesn't group by `observedOn`) | Collapses to 1 participating pair (`observationCount` 3, still one metric row) | `PASS` |
| A member's only entry for a metric is `VOIDED`, no other entry exists | **Counts as participating** (a row exists) | **Does not count as participating** (`observationCount` 0) | `EXPECTED_BREAKING` — see rationale below |

**`EXPECTED_BREAKING` rationale:** ADR-018 §2 defines participation as an
active resolved slot, not raw row existence — a `groupBy` over raw rows
was always wrong for a voided-only member, it simply had no way to be
wrong yet, because **no writer in this codebase produces a `VOIDED` row
today** (the void/correction mutation is a later, not-yet-built slice of
#287). This divergence is therefore inert in production as of this PR and
becomes correct-by-construction the moment void support ships, rather than
requiring a follow-up fix to this consumer at that time. No linked
follow-up issue is needed — the fix is already complete.

---

## `getAllianceMemberMetricMatrix.ts` (partial — cell values only)

- **Location:** `app/src/lib/reports/getAllianceMemberMetricMatrix.ts`
- **Old implementation:** raw `SELECT DISTINCT ON ("metricId", "allianceMemberId") ...` over `MemberMetricEntry`, scoped to the current page's `memberIds` via a `WHERE ... IN (...)` clause.
- **New implementation:** `memberPeriodMetricValues(..., { onlyParticipating: true, memberIds })` — the `memberIds` option (added in this PR after review) pushes the same page-scoping into the canonical read model's own query, so the fetch stays bounded to `pageSize × MATRIX_MAX_COLUMNS` rows regardless of alliance size, rather than cross-joining the full roster and filtering in JS.
- **Test:** [`getAllianceMemberMetricMatrixCellsParity.integration.test.ts`](../../app/src/lib/reports/getAllianceMemberMetricMatrixCellsParity.integration.test.ts)

| Input scenario | Old result summary | New result summary | Match result |
|---|---|---|---|
| Single entry | Value returned | Same value | `PASS` |
| Three corrections, same member+metric | Latest value returned | Same value (one winning slot) | `PASS` |
| No entry at all | Absent from result set; `buildCell`'s `?? null` renders `MISSING` | Absent from result set; same `MISSING` rendering | `PASS` |
| Voided-only entry, no other entry | Row returned with `value: null`; `buildCell` renders `MISSING` | Excluded entirely (`onlyParticipating`); `buildCell`'s `?? null` renders the same `MISSING` | `PASS` — unlike `getPeriodResultsSummary`'s participation *count*, this consumer's only observable output (cell status) is identical either way |
| Multi-metric, multi-member fixture | 3 rows (no row for the one (member, metric) pair with no entry) | Identical 3 rows | `PASS` |
| `DAILY_OBSERVATION + SUM` metric, three daily entries | Shows only the latest single day's raw value | Shows the true rolled-up sum | `EXPECTED_BREAKING` — see rationale below |

**`EXPECTED_BREAKING` rationale:** identical in kind to `getPeriodResultsSummary`'s divergence — the old raw `DISTINCT ON` has no concept of a metric's `memberPeriodRollup`, so it always showed "whichever single row sorts first," which is only coincidentally correct for `PERIOD_VALUE + LATEST` metrics. **Inert today**: no leader can create a `DAILY_OBSERVATION` metric yet (no UI exists to select a grain/rollup at creation time — see the database design §8's `Metric` writers section). Becomes correct-by-construction once that UI ships, rather than requiring a follow-up fix to this consumer at that time.

**Deliberately not migrated in this PR** (tracked as a follow-up below): `buildMatrixCte`'s `selected_values` CTE, which drives archived-member inclusion and metric-column sort tiering *before* pagination, still reads raw `MemberMetricEntry` rows directly. Migrating it requires either fetching the full alliance-wide cross join into JS to sort/paginate there, or extracting `memberPeriodMetricValues`'s CTE chain into a reusable `Prisma.sql` fragment this file's own paginated/sorted roster query can compose with — a larger architectural change than this PR's scope, and inert today for the same reason as above (no `DAILY_OBSERVATION` metric exists to sort/filter incorrectly).

---

## `getMetricSummaryReport.ts` (partial — `queryAggregate` + `queryVisualizationRows`)

- **Location:** `app/src/lib/reports/getMetricSummaryReport.ts`
- **Old implementation:** two independent raw `WITH latest AS (SELECT DISTINCT ON ("allianceMemberId") ...)` queries — one computing a cohort-wide rollup+coverage aggregate (`SUM`/`AVG`/`COUNT ... FILTER`), one fetching one `{allianceMemberId, playerName, archived, value}` row per qualifying member for the chart.
- **New implementation:** both now derive from `memberPeriodMetricValues(allianceId, periodId, [metricId])` (no `memberIds`/`onlyParticipating` filter — both are already full-cohort, unpaginated queries, same shape as the read model's own default cross join) plus a plain `prisma.allianceMember.findMany` roster fetch. Every counter in the aggregate (`sumValue`, `trueCount`, `invalidActiveMemberCount`, etc.) replicates its old SQL `FILTER` clause's exact condition field-for-field — see `computeAggregateSnapshot`'s doc comment for the full mapping.
- **Post-review perf fix:** the initial version had `queryAggregate` and `queryVisualizationRows` each independently call `memberPeriodMetricValues` + the roster query — a regression from the old shape's 1-query-each to 2 round-trips each (4 total) for any `SUM`/`AVERAGE`/`NONE+NUMERIC` report, duplicating two full-cohort reads on every request that needed both. Fixed by splitting fetch from computation: `fetchMemberPeriodValuesAndRoster` runs once per period, and both `computeAggregateSnapshot` and `deriveVisualizationRows` are now pure functions deriving their result from that one shared fetch. The comparison period (a different `periodId`) still gets its own independent fetch via a `queryAggregate` wrapper, since it never needs visualization rows.
- **Test:** [`getMetricSummaryReportAggregateParity.integration.test.ts`](../../app/src/lib/reports/getMetricSummaryReportAggregateParity.integration.test.ts)

| Input scenario | Old result summary | New result summary | Match result |
|---|---|---|---|
| Mixed-sign, mixed-participation `NUMERIC` cohort (active contributor, active negative contributor, active no-entry, archived contributor, archived no-entry) | `sumValue: 1139`, `hasNegativeValues: true`, full coverage breakdown | Identical, field-for-field | `PASS` |
| `BOOLEAN` metric: one `TRUE`, one `FALSE`, one archived `INVALID` (value `5`), one active missing | `trueCount: 1`, `falseCount: 1`, `invalidCount: 1`, `invalidActiveMemberCount: 0` (the invalid value is archived, not active) | Identical | `PASS` |
| Three corrections (same member+metric, different `recordedAt`) | Aggregate + visualization both use only the latest value | Identical | `PASS` |
| `DAILY_OBSERVATION + SUM` metric, three daily entries (10 each) for one member | Cohort total sums only the latest single day's raw value (`sumValue: 10`) | Cohort total correctly sums the member's true rolled-up period value (`sumValue: 30`) | `EXPECTED_BREAKING` — see rationale below |

**`EXPECTED_BREAKING` rationale:** identical in kind to the other two consumers above — the old raw `DISTINCT ON` has no concept of a metric's `memberPeriodRollup`, so a cohort-wide `SUM`/`AVERAGE` report was silently adding up each member's *latest single day's* value instead of their true period rollup. **Inert today**: no leader can create a `DAILY_OBSERVATION` metric yet. Becomes correct-by-construction once that UI ships.

Also newly correct-by-construction (not exercised by any parity scenario above because it requires a `DAILY_OBSERVATION + AVERAGE` metric, which — like all `DAILY_OBSERVATION` metrics — doesn't exist in production yet): `sumValue`/`averageValue` are now kept as exact, possibly-fractional sums rather than the old query's `::bigint`-cast total. Safe today because `MemberMetricEntry.value` is an integer column, so every legacy per-member value is already whole; would have silently rounded a fractional per-member `AVERAGE`-rollup value on the way into a cohort-wide `SUM` report otherwise.

**Deliberately not migrated in this PR** (tracked as a follow-up below): `buildRosterCte`/`countRosterRows`/`queryRosterRows` — the paginated, filtered, searched roster table — still reads raw `MemberMetricEntry` rows directly, including a `RANK() OVER (...)` window function computed over the *whole* (unfiltered, unpaginated) cohort before pagination. This is the exact same "value needed at the SQL level across every candidate row, not just the current page" tension deferred for the matrix's `selected_values` CTE above, and inert today for the identical reason.

---

## `getAlliancePerformanceReport.ts` (full — `queryBulkAggregates`)

- **Location:** `app/src/lib/reports/getAlliancePerformanceReport.ts`
- **Old implementation:** one raw `WITH latest AS (SELECT DISTINCT ON ("metricId", "allianceMemberId") ...)` query per request, cross-joining *every* requested metric against *every* alliance member at once (`metric_types` x `AllianceMember`), grouped by `metric_id`, with the same `SUM`/`AVG`/`COUNT ... FILTER` shape as `getMetricSummaryReport.ts`'s old per-metric `queryAggregate` but computed for the whole metric universe in one query.
- **New implementation:** one multi-metric `memberPeriodMetricValues(allianceId, periodId, metricIds)` call (the read model's own `requested_metrics x AllianceMember` cross join already covers every requested metric, matching the old query's cross join one-for-one) plus one `prisma.allianceMember.findMany` roster fetch, grouped by `metricId` in JS and passed through the **same shared `computeAggregateSnapshot`** (`metricRollup.ts`) that `getMetricSummaryReport.ts` uses — extracted there in this PR specifically so this file's per-metric aggregation rules can never drift from that file's, rather than re-implementing the same boolean-validity/coverage-counting logic a second time. `isBooleanByMetricId` is derived from the caller's already-fetched `metrics` (it needs `Metric.type` for other fields anyway), replacing the old query's own `metric_types` CTE.
- **Test:** [`getAlliancePerformanceReportBulkAggregateParity.integration.test.ts`](../../app/src/lib/reports/getAlliancePerformanceReportBulkAggregateParity.integration.test.ts) (new parity test) plus the pre-existing [`getAlliancePerformanceReport.integration.test.ts`](../../app/src/lib/reports/getAlliancePerformanceReport.integration.test.ts) (22 tests, unmodified, all passing against the new implementation — proof this migration didn't need to touch the file's own behavioral test suite at all).

| Input scenario | Old result summary | New result summary | Match result |
|---|---|---|---|
| Multi-metric batch: `SUM` metric (active + archived contributor), `BOOLEAN` metric (true/false), and a never-attached metric, all in one call | Three independent, correctly isolated per-metric aggregates; the unattached metric still gets a full all-`NULL` cross-join row per member | Identical, field-for-field, for every metric in the batch | `PASS` |
| `SUM`, `AVERAGE`, `TRUE_RATE`, `NONE` metrics plus one never-attached metric, in the full pre-existing integration suite | Full alliance-wide report body | Identical (all 22 pre-existing tests pass unmodified) | `PASS` |
| Three corrections (same member+metric, different `recordedAt`) | Collapses to the latest value | Collapses to the latest value (one winning slot) | `PASS` |
| Invalid legacy `BOOLEAN` value (neither 0 nor 1) | Counted in `expectedCells`/`invalidCount`, excluded from `validCells`/`trueCount`/`falseCount` | Identical | `PASS` |
| Within a multi-metric batch, one `DAILY_OBSERVATION + SUM` metric alongside one ordinary `PERIOD_VALUE + LATEST` metric, three daily entries (10 each) for one member | Cohort total sums only the latest single day's raw value (`sumValue: 10`); the sibling metric in the same batch is unaffected | Cohort total correctly sums the member's true rolled-up period value (`sumValue: 30`); the sibling metric is identical to old | `EXPECTED_BREAKING` — see rationale below |

**`EXPECTED_BREAKING` rationale:** identical in kind and cause to the three prior consumers' divergences above — the old raw `DISTINCT ON` has no concept of a metric's `memberPeriodRollup`, so an alliance-wide `SUM`/`AVERAGE` metric total was silently adding up each member's *latest single day's* value instead of their true period rollup. **Inert today**: no leader can create a `DAILY_OBSERVATION` metric yet. Becomes correct-by-construction once that UI ships. This migration additionally demonstrates the divergence is *isolated per metric* within a multi-metric batch — an ordinary `PERIOD_VALUE + LATEST` metric queried in the same call as a `DAILY_OBSERVATION + SUM` metric is completely unaffected, since `computeAggregateSnapshot` is derived and grouped independently per `metricId`.

Also newly correct-by-construction, for the same reason noted under `getMetricSummaryReport.ts` above and not separately re-tested here (same shared `computeAggregateSnapshot`, same underlying fix): `sumValue`/`averageValue` are now exact, possibly-fractional sums rather than the old query's `::bigint`-cast total.

No follow-up deferred for this consumer — `getAlliancePerformanceReport.ts` never paginates, sorts, filters, or searches a member roster (that's the member matrix, per its own module doc comment), so it has no paginated/pre-pagination-ranked query analogous to the matrix's `selected_values` CTE or `getMetricSummaryReport.ts`'s roster table left to migrate.

---

## `members/page.tsx` (full — `latestMetricValueByMemberAndMetric`)

- **Location:** `app/alliances/[allianceId]/members/page.tsx`
- **Old implementation:** `prisma.memberMetricEntry.findMany(...)` ordered by `recordedAt`/`createdAt`/`id` DESC, then a JS scan that keeps the first (i.e. most recent) row per `(allianceMemberId, metricId)` key, `continue`-ing past a `value === null` row without marking the key as seen.
- **New implementation:** `memberPeriodMetricValues(allianceId, periodId, periodMetricIds, { onlyParticipating: true, memberIds })` — bounded to the page's already-filtered roster (`memberIds`) and the selected period's active metric columns (`periodMetricIds`), matching the old query's own `WHERE` scoping exactly.
- **Test:** [`membersMetricValuesParity.integration.test.ts`](../../app/alliances/[allianceId]/members/membersMetricValuesParity.integration.test.ts)

| Input scenario | Old result summary | New result summary | Match result |
|---|---|---|---|
| Two corrections (same member+metric, different `recordedAt`) | Collapses to the latest value | Collapses to the latest value (one winning slot) | `PASS` |
| A member with no entry; a member with a real entry excluded from the page's own `memberIds` (e.g. a different filter/page) | Absent from the map either way — the old query's own `allianceMemberId: { in: memberIds }` clause already bounded it | Absent from the map (same bound, pushed into `memberPeriodMetricValues`'s own SQL) | `PASS` |
| A member's most recent event for a metric is a **VOIDED correction of a previously ACTIVE value** | **Incorrectly falls back to the stale ACTIVE value** — the scan's `continue` on the null-valued VOIDED row never marks the key "seen," so it keeps scanning into the earlier ACTIVE row | **Correctly omits the pair** — `memberPeriodMetricValues`'s `slot_winner` picks the VOIDED row as the winner (latest by `recordedAt`, regardless of status), leaving zero active winning slots | `EXPECTED_BREAKING` — see rationale below |

**`EXPECTED_BREAKING` rationale:** this is a genuine pre-existing bug in the old scan, not merely a `DAILY_OBSERVATION`-only gap like the other consumers' divergences above: the old code's `if (entry.value === null) continue` was written to *skip* a void, but skipping without marking the key as resolved means a later scan iteration can still write the stale prior value for that same key. **Inert today**: no write path can create a `VOIDED` row yet (the void/correction mutation is a later, not-yet-built slice of #287), so this bug has never been observable in production. Becomes correct-by-construction the moment void support ships, rather than requiring a follow-up fix to this consumer at that time.

---

## Remaining consumers (not yet migrated)

Per the database design §8 inventory, tracked here so this table stays the
single place progress is visible:

- [ ] `getAllianceMemberMetricMatrix.ts`'s `selected_values` CTE (archived-inclusion + metric-sort tiering, pre-pagination) — see follow-up above
- [ ] `getMetricSummaryReport.ts`'s `buildRosterCte`/`countRosterRows`/`queryRosterRows` (paginated, ranked roster table) — see follow-up above
- [ ] `apsDataReadinessAudit.ts` (`queryCoverageAndDistribution`, `queryPeriodsWithValidDataCounts`) — needs `memberPeriodMetricValues` to accept the audit's `AuditTxClient` (read-only transaction) instead of the global `prisma` client; larger change than a single-consumer swap
- [ ] `members/[memberId]/page.tsx` (loads all period entries, keeps two — "current vs. previous correction" is a distinct concept from the canonical rollup's single value; needs design thought before migrating, not a 1:1 swap)
- [ ] `allianceSetup.ts` (setup-checklist count, `targetEntriesCount`)
- [ ] `betaParticipants.ts` (`has_target_period_data`, `is_complete`)
- [ ] `platform/setup.ts` (`alliancesWithData`, `getStalledAlliances`)
- [ ] `platform/alliances.ts` (`hasData` readiness check)
- [ ] `betaDashboard.ts` (`alliancesWithData`, `getAllianceReadiness`, `getNeedsAttention`)
