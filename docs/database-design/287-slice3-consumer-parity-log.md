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

## Remaining consumers (not yet migrated)

Per the database design §8 inventory, tracked here so this table stays the
single place progress is visible:

- [ ] `getAllianceMemberMetricMatrix.ts` (roster CTE + cell-value query)
- [ ] `getMetricSummaryReport.ts` (`queryAggregate`, `queryVisualizationRows`, `buildRosterCte`)
- [ ] `getAlliancePerformanceReport.ts`
- [ ] `apsDataReadinessAudit.ts` (`queryCoverageAndDistribution`, `queryPeriodsWithValidDataCounts`)
- [ ] `members/page.tsx` (unbounded in-memory `latestMetricValueByMemberAndMetric` reduction)
- [ ] `members/[memberId]/page.tsx` (loads all period entries, keeps two)
- [ ] `allianceSetup.ts` (setup-checklist count, `targetEntriesCount`)
- [ ] `betaParticipants.ts` (`has_target_period_data`, `is_complete`)
- [ ] `platform/setup.ts` (`alliancesWithData`, `getStalledAlliances`)
- [ ] `platform/alliances.ts` (`hasData` readiness check)
- [ ] `betaDashboard.ts` (`alliancesWithData`, `getAllianceReadiness`, `getNeedsAttention`)
