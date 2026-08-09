import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { prisma } from "@/app/src/lib/prisma";
import {
  resolveComparisonPeriodSelection,
  type ComparablePeriodCandidate,
  type EligiblePeriodOption,
} from "@/app/src/lib/reports/resolveComparablePeriod";
import {
  buildMetricReportRow,
  buildMetricRollup,
  computeRollupChange,
  computeShareAvailability,
  mapAggregateRow,
  type AggregateRawRow,
  type AggregateSnapshot,
  type BooleanRowStatus,
  type MetricCoverage,
  type MetricRollup,
  type MetricShareAvailability,
} from "@/app/src/lib/reports/metricRollup";
import { buildMetricVisualModel, type MetricVisualModel, type VisualCohortRow } from "@/app/src/lib/reports/metricVisualModel";
import { buildMetricInterpretationSummary } from "@/app/src/lib/reports/metricInterpretationSummary";
import {
  memberPeriodMetricValues,
  type MemberPeriodMetricValue,
} from "@/app/src/lib/metrics/memberPeriodMetricValues";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";

// Re-exported so every existing importer of these previously-local
// names (tests, getAlliancePerformanceReport.ts) keeps working unchanged —
// only their *definition* moved to metricRollup.ts (#264 PR4), to give
// metricVisualModel.ts's pure builders a server-only-free home for the
// same rollup math, mirroring the allianceMemberMatrix.ts split (PR3).
export {
  buildMetricReportRow,
  buildMetricRollup,
  computeRollupChange,
  computeShareAvailability,
  mapAggregateRow,
  type AggregateRawRow,
  type AggregateSnapshot,
  type BooleanRowStatus,
  type MetricCoverage,
  type MetricRollup,
  type MetricShareAvailability,
};
export { computeDifferenceFromAverage, computeBooleanRowStatus } from "@/app/src/lib/reports/metricRollup";
export type { MetricVisualModel } from "@/app/src/lib/reports/metricVisualModel";

/**
 * Generic per-metric summary report read model (#190).
 *
 * Works identically for any alliance-configured metric — VS Score,
 * Donations, Battle Participation, or anything else — driven entirely by
 * `Metric.summaryKind`. There is no metric-identity-specific branching here.
 *
 * Built as bounded, paginated, DB-side queries from the start using
 * `prisma.$queryRaw`/`Prisma.sql` (same pattern as
 * `platform/accessRequestInbox.ts` and `platform/feedbackInbox.ts`) —
 * Postgres `DISTINCT ON` and window functions have no Prisma query-builder
 * equivalent, and this report must never fetch every historical entry or
 * every roster member into JS to compute a total.
 *
 * Two independent round-trips drive the report body:
 *   1. A rollup+coverage aggregate over the *entire* cohort (unaffected by
 *      display filter/search/sort/pagination) — the "total" a leader sees
 *      must never silently change because they searched for a name.
 *   2. A paginated/filtered/sorted roster query for the visible table rows.
 * (2) still runs its own raw SQL, sharing a `latest`-per-member
 * `DISTINCT ON` CTE with itself across pagination/count/rank; (1) now
 * sources its per-member values from the canonical read model instead
 * (#287 Slice 3 — see the partial-migration note below).
 *
 * #287 Slice 3 (partial): `queryAggregate` and `queryVisualizationRows` —
 * both full-cohort, *unpaginated* queries — migrated to
 * `memberPeriodMetricValues` (ADR-018 §6), so a `DAILY_OBSERVATION`
 * metric's cohort total correctly aggregates each member's true rolled-up
 * period value instead of their latest single day's raw entry. The
 * paginated/sorted/searched roster query below (2) did not: its
 * competition ranking is a SQL window function computed over the *whole*
 * (unfiltered, unpaginated) cohort before pagination — the same "value
 * needed at the SQL level across every candidate row, not just the current
 * page" tension deferred for `getAllianceMemberMetricMatrix.ts`'s
 * `selected_values` CTE, and deferred here for the identical reason (see
 * `docs/database-design/287-slice3-consumer-parity-log.md`): inert today,
 * since no leader can create a `DAILY_OBSERVATION` metric yet.
 */

export type MetricReportSort = "value_desc" | "value_asc" | "name_asc";
export type MemberRosterFilter = "active" | "archived" | "all";

export const METRIC_REPORT_PAGE_SIZE_MIN = 10;
export const METRIC_REPORT_PAGE_SIZE_DEFAULT = 25;
export const METRIC_REPORT_PAGE_SIZE_MAX = 100;
export const METRIC_REPORT_SEARCH_MAX_LENGTH = 100;

export class MetricSummaryReportNotFoundError extends Error {
  constructor(public readonly resource: "metric" | "period") {
    super(`${resource} not found`);
    this.name = "MetricSummaryReportNotFoundError";
  }
}

export type MetricInfo = {
  id: string;
  name: string;
  type: Metric_Type;
  summaryKind: MetricSummaryKind;
  unitLabel: string | null;
  active: boolean;
  /** #264 PR2 — see metricTrendDirection.ts. Consumed by the deterministic findings engine, not by this report. */
  trendDirection: MetricTrendDirection;
};

export type PeriodInfo = {
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
};

/**
 * Independent from `MetricPeriodDataStatus` on purpose — this correctly
 * represents "inactive with history," "inactive without history," and
 * "active but nothing recorded yet" without collapsing distinct states into
 * one overloaded enum. `NOT_ATTACHED` always implies `NO_VALUES` (the
 * schema's `MemberMetricEntry -> MetricPeriodMetric` FK makes an entry
 * impossible without *some* attachment row, even an inactive one), but the
 * reverse isn't true — an active attachment can still have zero values.
 */
export type MetricPeriodAttachmentStatus = "NOT_ATTACHED" | "ACTIVE" | "INACTIVE";
export type MetricPeriodDataStatus = "NO_VALUES" | "HAS_VALUES";

// MetricShareAvailability, MetricRollup, BooleanRowStatus now live in
// metricRollup.ts and are re-exported above.

export type MetricReportRow = {
  allianceMemberId: string;
  playerName: string;
  archived: boolean;
  value: number | null;
  /** Competition rank over the full cohort's valid values. Always null for TRUE_RATE (status only). */
  rank: number | null;
  /** Only meaningful when the metric's type is BOOLEAN; null otherwise. */
  booleanStatus: BooleanRowStatus | null;
  /** Only populated for a SUM-kind metric with a recorded value. */
  share: MetricShareAvailability | null;
  /** Only populated for an AVERAGE-kind metric with a recorded value. */
  differenceFromAverage: number | null;
};

// MetricCoverage now lives in metricRollup.ts and is re-exported above.

export type MetricSummaryComparison =
  | { status: "NO_ELIGIBLE_PERIOD" }
  | {
      status: "INVALID_COMPARISON_PERIOD";
      requestedPeriodId: string;
      recommended: EligiblePeriodOption | null;
      eligiblePeriods: EligiblePeriodOption[];
    }
  | {
      status: "NO_DATA_IN_COMPARISON_PERIOD";
      period: EligiblePeriodOption;
      eligiblePeriods: EligiblePeriodOption[];
    }
  | {
      /**
       * The resolved comparison period has data, but the *selected* period
       * doesn't (dataStatus === "NO_VALUES", which also covers
       * attachmentStatus === "NOT_ATTACHED"). Reported separately from
       * `COMPARED` because the selected rollup — e.g. a SUM total of 0 —
       * is an absence of data, not a measured decline to zero. Computing a
       * change against it would fabricate a misleading swing (typically
       * -100%) for a period that simply has nothing recorded yet.
       */
      status: "NO_DATA_IN_SELECTED_PERIOD";
      period: EligiblePeriodOption;
      eligiblePeriods: EligiblePeriodOption[];
    }
  | {
      status: "COMPARED";
      period: EligiblePeriodOption;
      eligiblePeriods: EligiblePeriodOption[];
      rollup: MetricRollup;
      /** Selected minus comparison, in the rollup's native unit (raw units for SUM/AVERAGE, percentage points for TRUE_RATE). */
      absoluteChange: number | null;
      /** Relative percentage change. Only meaningful for SUM/AVERAGE; always null for TRUE_RATE (already a point change). */
      percentageChange: number | null;
    };

export type MetricSummaryReport = {
  metric: MetricInfo;
  period: PeriodInfo;
  attachmentStatus: MetricPeriodAttachmentStatus;
  dataStatus: MetricPeriodDataStatus;
  rollup: MetricRollup;
  coverage: MetricCoverage;
  /** Null only when `metric.summaryKind === "NONE"` — there is no rollup to compare. */
  comparison: MetricSummaryComparison | null;
  /** #264 PR4 — the bounded, full-cohort chart model. Independent of `rows`'/`pagination`'s roster search/filter/sort/pagination. */
  visualModel: MetricVisualModel;
  /** #264 PR4 — the deterministic "what this tells you" one-sentence takeaway. See metricInterpretationSummary.ts for its priority rules. */
  interpretationSummary: string;
  rows: MetricReportRow[];
  pagination: { page: number; pageSize: number; totalRowCount: number };
  sort: MetricReportSort;
  filter: MemberRosterFilter;
  /** The bounded, trimmed search term actually applied (may differ from the raw input if it was truncated). */
  search: string;
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable directly, no Prisma/DB involved)
// ---------------------------------------------------------------------------

export function normalizeSort(sort: MetricReportSort | string | undefined | null): MetricReportSort {
  return sort === "value_asc" || sort === "name_asc" ? sort : "value_desc";
}

export function normalizeFilter(
  filter: MemberRosterFilter | string | undefined | null,
): MemberRosterFilter {
  return filter === "archived" || filter === "all" ? filter : "active";
}

export function clampPageSize(pageSize: number | undefined | null): number {
  if (!Number.isFinite(pageSize)) return METRIC_REPORT_PAGE_SIZE_DEFAULT;
  const floored = Math.floor(pageSize as number);
  return Math.min(METRIC_REPORT_PAGE_SIZE_MAX, Math.max(METRIC_REPORT_PAGE_SIZE_MIN, floored));
}

export function clampRequestedPage(page: number | undefined | null): number {
  if (!Number.isFinite(page) || (page as number) < 1) return 1;
  return Math.floor(page as number);
}

/**
 * The count query (no filter-dependent rank/sort) always runs before this —
 * an out-of-range page number never silently returns zero rows, it clamps
 * down to the last real page.
 */
export function resolvePageAgainstTotal(
  requestedPage: number,
  totalRowCount: number,
  pageSize: number,
): number {
  const totalPages = Math.max(1, Math.ceil(totalRowCount / pageSize));
  return Math.min(requestedPage, totalPages);
}

export function boundSearchInput(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.trim().slice(0, METRIC_REPORT_SEARCH_MAX_LENGTH);
}

/** Escape `%`, `_`, and `\` for use with `ILIKE ... ESCAPE '\'`. */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Empty string is the "no search filter" sentinel used throughout the SQL below. */
export function buildSearchPattern(raw: string | undefined | null): string {
  const bounded = boundSearchInput(raw);
  return bounded ? `%${escapeIlikePattern(bounded)}%` : "";
}

// AggregateSnapshot, buildMetricRollup, computeShareAvailability,
// computeDifferenceFromAverage, computeBooleanRowStatus,
// buildMetricReportRow, computeRollupChange, AggregateRawRow, and
// mapAggregateRow now all live in metricRollup.ts and are re-exported above.

// ---------------------------------------------------------------------------
// Raw SQL orchestration
// ---------------------------------------------------------------------------

type AggregateRosterMember = { id: string; playerName: string; archivedAt: Date | null };

/**
 * The alliance's full member roster, ordered exactly as Postgres would
 * order `ORDER BY "playerName" ASC, id ASC` (via Prisma's query builder,
 * not raw SQL - there's no `DISTINCT ON`/window function need here) so
 * `queryVisualizationRows` never has to re-sort in JS and risk a
 * collation mismatch with the database's own ordering.
 */
async function queryAllianceMemberRoster(allianceId: string): Promise<AggregateRosterMember[]> {
  return prisma.allianceMember.findMany({
    where: { allianceId },
    select: { id: true, playerName: true, archivedAt: true },
    orderBy: [{ playerName: "asc" }, { id: "asc" }],
  });
}

/**
 * The two DB round-trips `queryAggregate` and `queryVisualizationRows` each
 * need for a given (allianceId, periodId, metricId) — split out so a
 * request that needs *both* (any SUM/AVERAGE/NONE+NUMERIC report) fetches
 * once and derives both results from the same in-memory data, rather than
 * each independently re-fetching the identical full-cohort values + roster.
 *
 * #287 Slice 3 perf fix (post-review): the initial migration had
 * `queryAggregate`/`queryVisualizationRows` each call
 * `memberPeriodMetricValues` + the roster query independently, doubling
 * two full-cohort reads on every request that needed both — a regression
 * from the old raw-SQL shape's 1-query-each. See
 * `docs/database-design/287-slice3-consumer-parity-log.md`.
 *
 * Always exactly 2 round trips, *regardless of `needsVisualizationRows`* —
 * this is not an opportunity for a further "aggregate-only, skip the
 * roster" path. `computeAggregateSnapshot` needs `roster`'s `archivedAt`
 * for every summary kind, including `TRUE_RATE`/`NONE+BOOLEAN`
 * (`currentActiveMemberCount`, `recordedActiveMemberCount`,
 * `missingActiveMemberCount`, `archivedContributingMemberCount` are all
 * archived-aware coverage counts, not chart-only concerns). The old
 * `queryAggregate` got both the value and the archived flag in a single
 * combined `AllianceMember LEFT JOIN latest` query; this one costs one
 * extra bounded, O(alliance-size) round trip instead, because
 * `memberPeriodMetricValues` is deliberately metric-domain-only and knows
 * nothing about alliance membership - folding `archivedAt` into it would
 * blur that boundary for every other consumer (`getPeriodResultsSummary.ts`,
 * the matrix, etc.) to save one query here. Accepted as the correct,
 * already-tested-safe cost of reusing the canonical read model (same order
 * of magnitude validated by
 * `memberPeriodRollupTenantIsolationAndPerformance.integration.test.ts`).
 */
async function fetchMemberPeriodValuesAndRoster(
  allianceId: string,
  periodId: string,
  metricId: string,
): Promise<{ values: MemberPeriodMetricValue[]; roster: AggregateRosterMember[] }> {
  const [values, roster] = await Promise.all([
    memberPeriodMetricValues(allianceId, periodId, [metricId]),
    queryAllianceMemberRoster(allianceId),
  ]);
  return { values, roster };
}

/**
 * Pure derivation of the rollup + coverage aggregate from already-fetched
 * values/roster (both active and archived contributors) — never against a
 * filtered/paginated slice.
 *
 * #287 Slice 3: sources each member's value from `memberPeriodMetricValues`
 * (ADR-018 §6) instead of a raw `DISTINCT ON` over `MemberMetricEntry`, so
 * a `DAILY_OBSERVATION` metric's total correctly aggregates each member's
 * true rolled-up period value (inert today - no leader can create one yet;
 * see `docs/database-design/287-slice3-consumer-parity-log.md`).
 *
 * Every counter below replicates its prior SQL `FILTER` clause exactly,
 * field for field, to preserve the legacy invariant: `sum`/`average` only
 * include a *valid* value (boolean-checked when relevant); `hasNegativeValues`
 * and `latestEntryCount` check raw presence only, never boolean validity;
 * `archivedContributingMemberCount` counts *any* archived value, valid or
 * not — matching `buildRosterFromWhere`'s own "archived + has a value"
 * inclusion rule elsewhere in this file.
 *
 * `sumValue`/`averageValue` are kept as exact (possibly fractional) sums,
 * not rounded to a whole number the way the old query's `::bigint` cast
 * did — safe today, since `MemberMetricEntry.value` is an integer column so
 * every legacy per-member value is already whole, but correct-by-construction
 * once a `DAILY_OBSERVATION + AVERAGE` metric's fractional per-member value
 * (e.g. 12.5) needs to contribute an exact amount to this cohort-wide total,
 * rather than being silently rounded on the way in.
 */
function computeAggregateSnapshot(
  values: readonly MemberPeriodMetricValue[],
  roster: readonly AggregateRosterMember[],
  isBooleanMetric: boolean,
): AggregateSnapshot {
  const valueByMember = new Map(values.map((row) => [row.allianceMemberId, row.value]));

  let sumValue = 0;
  let averageSum = 0;
  let averageCount = 0;
  let trueCount = 0;
  let falseCount = 0;
  let invalidCount = 0;
  let hasNegativeValues = false;
  let currentActiveMemberCount = 0;
  let recordedActiveMemberCount = 0;
  let invalidActiveMemberCount = 0;
  let missingActiveMemberCount = 0;
  let archivedContributingMemberCount = 0;
  let latestEntryCount = 0;

  for (const member of roster) {
    const archived = member.archivedAt !== null;
    const value = valueByMember.get(member.id) ?? null;
    const isValid = value !== null && (!isBooleanMetric || isValidBooleanMetricValue(value));

    if (!archived) currentActiveMemberCount++;
    if (value !== null && value < 0) hasNegativeValues = true;
    if (value !== null) latestEntryCount++;

    if (isBooleanMetric && value !== null) {
      if (value === 1) trueCount++;
      else if (value === 0) falseCount++;
      else invalidCount++;
    }

    if (isValid) {
      sumValue += value;
      averageSum += value;
      averageCount++;
    }

    if (!archived) {
      if (isValid) recordedActiveMemberCount++;
      if (isBooleanMetric && value !== null && !isValid) invalidActiveMemberCount++;
      if (value === null) missingActiveMemberCount++;
    } else if (value !== null) {
      archivedContributingMemberCount++;
    }
  }

  return {
    sumValue,
    averageValue: averageCount > 0 ? averageSum / averageCount : null,
    trueCount,
    falseCount,
    invalidCount,
    hasNegativeValues,
    currentActiveMemberCount,
    recordedActiveMemberCount,
    invalidActiveMemberCount,
    missingActiveMemberCount,
    archivedContributingMemberCount,
    latestEntryCount,
  };
}

/**
 * Fetch + compute in one call, for callers (only the comparison period,
 * below) that need *just* the aggregate for a period and have no
 * visualization rows to derive alongside it.
 */
async function queryAggregate(
  allianceId: string,
  periodId: string,
  metricId: string,
  isBooleanMetric: boolean,
): Promise<AggregateSnapshot> {
  const { values, roster } = await fetchMemberPeriodValuesAndRoster(allianceId, periodId, metricId);
  return computeAggregateSnapshot(values, roster, isBooleanMetric);
}

/**
 * Pure derivation of the bounded, full-cohort row set backing the metric's
 * chart (`metricVisualModel.ts`'s builders) — #264 PR4, from
 * already-fetched values/roster (shared with `computeAggregateSnapshot`
 * for the primary period - see `fetchMemberPeriodValuesAndRoster`).
 * Independent of the roster's own search/filter/sort/pagination on
 * purpose: a leader searching the roster for one player must never change
 * what the chart above it shows for the whole alliance.
 *
 * Inclusion mirrors the roster's own "all" filter exactly (every active
 * member, including a missing value; an archived member only if they
 * contributed) — see `buildRosterFromWhere` — because that's already the
 * correct "everyone whose data belongs in an alliance-wide chart this
 * period" rule; there was no need to invent a second one. Unlike the
 * roster, this never excludes or nulls out an invalid boolean value: the
 * value comes straight from `memberPeriodMetricValues`, which is itself
 * type-agnostic (ADR-018 §6) — `metricVisualModel.ts` needs the *raw*
 * value to keep TRUE_RATE/data-quality states honest, and makes its own
 * decisions about what to do with it.
 *
 * Bounded at exactly one row per qualifying member — O(alliance members),
 * never O(entries).
 */
function deriveVisualizationRows(
  values: readonly MemberPeriodMetricValue[],
  roster: readonly AggregateRosterMember[],
): VisualCohortRow[] {
  const valueByMember = new Map(values.map((row) => [row.allianceMemberId, row.value]));

  return roster
    .filter((member) => member.archivedAt === null || valueByMember.get(member.id) != null)
    .map((member) => ({
      allianceMemberId: member.id,
      playerName: member.playerName,
      archived: member.archivedAt !== null,
      value: valueByMember.get(member.id) ?? null,
    }));
}

type RosterRawRow = {
  alliance_member_id: string;
  player_name: string;
  archived: boolean;
  value: number | null;
  rank: bigint | null;
};

type RosterQueryParams = {
  allianceId: string;
  periodId: string;
  metricId: string;
  isBooleanMetric: boolean;
  filter: MemberRosterFilter;
  searchPattern: string;
};

/**
 * Shared CTEs for the roster query. Ranking is computed here, over the full
 * (unfiltered, unpaginated) `latest` cohort, in its own CTE — a SQL window
 * function runs after a query's WHERE clause, so computing it inside the
 * filtered/paginated query below would let search or roster filters
 * silently renumber members. `rankMetricRows.ts` is a pure test oracle for
 * this exact ranking semantics (ties, exclusions), not called from here.
 */
function buildRosterCte(params: RosterQueryParams): Prisma.Sql {
  const { periodId, metricId, isBooleanMetric } = params;
  return Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON ("allianceMemberId") "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" = ${metricId}
      ORDER BY "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    ),
    ranked AS (
      SELECT member_id, RANK() OVER (ORDER BY value DESC) AS rank
      FROM latest
      WHERE value IS NOT NULL AND (NOT ${isBooleanMetric}::boolean OR value IN (0, 1))
    )
  `;
}

/**
 * Roster inclusion by filter:
 *   - active: all active members (missing values still shown as a row).
 *   - archived: only archived members *with* a recorded value — archived
 *     members who never contributed this period are irrelevant historical
 *     non-contributors, not "missing" rows.
 *   - all: both of the above.
 */
function buildRosterFromWhere(params: RosterQueryParams): Prisma.Sql {
  const { allianceId, filter, searchPattern } = params;
  return Prisma.sql`
    FROM "AllianceMember" am
    LEFT JOIN latest l ON l.member_id = am.id
    LEFT JOIN ranked r ON r.member_id = am.id
    WHERE am."allianceId" = ${allianceId}
      AND (
        (${filter}::text = 'active' AND am."archivedAt" IS NULL)
        OR (${filter}::text = 'archived' AND am."archivedAt" IS NOT NULL AND l.value IS NOT NULL)
        OR (${filter}::text = 'all' AND (am."archivedAt" IS NULL OR l.value IS NOT NULL))
      )
      AND (${searchPattern}::text = '' OR am."playerName" ILIKE ${searchPattern} ESCAPE '\\')
  `;
}

/**
 * Sorting by value uses an "effective" value that is NULL for a legacy
 * out-of-range boolean value (mirroring `ranked`'s exclusion) — otherwise an
 * INVALID row would sort above every valid TRUE/FALSE row under
 * `value_desc`, contradicting its exclusion from ranking and the rate.
 */
function buildRosterOrderBy(sort: MetricReportSort, isBooleanMetric: boolean): Prisma.Sql {
  const effectiveValue = Prisma.sql`(
    CASE
      WHEN ${isBooleanMetric}::boolean AND l.value IS NOT NULL AND l.value NOT IN (0, 1) THEN NULL
      ELSE l.value
    END
  )`;
  switch (sort) {
    case "value_asc":
      return Prisma.sql`${effectiveValue} ASC NULLS LAST, am."playerName" ASC, am.id ASC`;
    case "name_asc":
      return Prisma.sql`am."playerName" ASC, am.id ASC`;
    case "value_desc":
    default:
      return Prisma.sql`${effectiveValue} DESC NULLS LAST, am."playerName" ASC, am.id ASC`;
  }
}

async function countRosterRows(params: RosterQueryParams): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    ${buildRosterCte(params)}
    SELECT COUNT(*)::bigint AS total
    ${buildRosterFromWhere(params)}
  `;
  return Number(rows[0]?.total ?? BigInt(0));
}

async function queryRosterRows(
  params: RosterQueryParams,
  sort: MetricReportSort,
  pageSize: number,
  offset: number,
): Promise<RosterRawRow[]> {
  return prisma.$queryRaw<RosterRawRow[]>`
    ${buildRosterCte(params)}
    SELECT
      am.id AS alliance_member_id,
      am."playerName" AS player_name,
      (am."archivedAt" IS NOT NULL) AS archived,
      l.value AS value,
      r.rank AS rank
    ${buildRosterFromWhere(params)}
    ORDER BY ${buildRosterOrderBy(sort, params.isBooleanMetric)}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
}

async function loadComparisonCandidates(
  allianceId: string,
  metricId: string,
  excludePeriodId: string,
): Promise<ComparablePeriodCandidate[]> {
  const periods = await prisma.metricPeriod.findMany({
    where: { allianceId, id: { not: excludePeriodId } },
    select: {
      id: true,
      name: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      periodMetrics: { where: { metricId }, select: { active: true } },
    },
    // Matches `sortEligibleComparisonPeriods`'s tiebreak precedence so this
    // list is deterministic before the pure eligibility/ordering logic ever
    // sees it, not only after — Postgres gives no ordering guarantee
    // without an explicit ORDER BY.
    orderBy: [{ startsAt: "desc" }, { endsAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  return periods.map((period) => ({
    id: period.id,
    name: period.name,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    createdAt: period.createdAt,
    metricAttachedActive: period.periodMetrics.some((attachment) => attachment.active),
  }));
}

async function buildComparisonSection(params: {
  allianceId: string;
  metricId: string;
  isBooleanMetric: boolean;
  summaryKind: MetricSummaryKind;
  selectedPeriod: PeriodInfo;
  selectedRollup: MetricRollup;
  selectedDataStatus: MetricPeriodDataStatus;
  comparePeriodId: string | undefined;
}): Promise<MetricSummaryComparison | null> {
  const {
    allianceId,
    metricId,
    isBooleanMetric,
    summaryKind,
    selectedPeriod,
    selectedRollup,
    selectedDataStatus,
    comparePeriodId,
  } = params;

  if (summaryKind === MetricSummaryKind.NONE) {
    return null;
  }

  const candidates = await loadComparisonCandidates(allianceId, metricId, selectedPeriod.id);
  const selection = resolveComparisonPeriodSelection({
    requestedPeriodId: comparePeriodId ?? null,
    candidates,
    selected: { startsAt: selectedPeriod.startsAt, endsAt: selectedPeriod.endsAt },
  });

  if (selection.status === "NO_ELIGIBLE_PERIOD") {
    return { status: "NO_ELIGIBLE_PERIOD" };
  }

  if (selection.status === "INVALID_COMPARISON_PERIOD") {
    return {
      status: "INVALID_COMPARISON_PERIOD",
      requestedPeriodId: selection.requestedPeriodId,
      recommended: selection.recommended,
      eligiblePeriods: selection.eligiblePeriods,
    };
  }

  if (selectedDataStatus === "NO_VALUES") {
    return {
      status: "NO_DATA_IN_SELECTED_PERIOD",
      period: selection.period,
      eligiblePeriods: selection.eligiblePeriods,
    };
  }

  const comparisonAggregate = await queryAggregate(
    allianceId,
    selection.period.id,
    metricId,
    isBooleanMetric,
  );

  if (comparisonAggregate.latestEntryCount === 0) {
    return {
      status: "NO_DATA_IN_COMPARISON_PERIOD",
      period: selection.period,
      eligiblePeriods: selection.eligiblePeriods,
    };
  }

  const comparisonRollup = buildMetricRollup(summaryKind, comparisonAggregate);
  const { absoluteChange, percentageChange } = computeRollupChange(
    summaryKind,
    selectedRollup,
    comparisonRollup,
  );

  return {
    status: "COMPARED",
    period: selection.period,
    eligiblePeriods: selection.eligiblePeriods,
    rollup: comparisonRollup,
    absoluteChange,
    percentageChange,
  };
}

/**
 * The metric summary report for one metric in one period.
 *
 * Tenant scoping: `metric` and `period` are both looked up scoped to
 * `allianceId`; a `metricId`/`periodId` belonging to another alliance simply
 * doesn't resolve and throws `MetricSummaryReportNotFoundError`. Callers
 * (server actions/pages) must already have verified the acting user has
 * access to `allianceId` — this function trusts that boundary, matching
 * every other alliance-scoped read model in the app.
 *
 * `periodId` is required and assumed already resolved by the caller (e.g.
 * via `resolveDefaultReportPeriod` when a URL doesn't specify one) — this
 * function has no opinion on "current period," since a period can be
 * current for the alliance without this metric ever having been attached to
 * it.
 */
export async function getMetricSummaryReport(params: {
  allianceId: string;
  metricId: string;
  periodId: string;
  comparePeriodId?: string;
  sort?: MetricReportSort;
  filter?: MemberRosterFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<MetricSummaryReport> {
  const { allianceId, metricId, periodId, comparePeriodId } = params;

  const [metric, period, attachment] = await Promise.all([
    prisma.metric.findFirst({
      where: { id: metricId, allianceId },
      select: { id: true, name: true, type: true, summaryKind: true, unitLabel: true, active: true, trendDirection: true },
    }),
    prisma.metricPeriod.findFirst({
      where: { id: periodId, allianceId },
      select: { id: true, name: true, startsAt: true, endsAt: true, active: true },
    }),
    prisma.metricPeriodMetric.findUnique({
      where: { periodId_metricId: { periodId, metricId } },
      select: { active: true },
    }),
  ]);

  if (!metric) throw new MetricSummaryReportNotFoundError("metric");
  if (!period) throw new MetricSummaryReportNotFoundError("period");

  const attachmentStatus: MetricPeriodAttachmentStatus = !attachment
    ? "NOT_ATTACHED"
    : attachment.active
      ? "ACTIVE"
      : "INACTIVE";

  const isBooleanMetric = metric.type === Metric_Type.BOOLEAN;
  const sort = normalizeSort(params.sort);
  const filter = normalizeFilter(params.filter);
  const searchPattern = buildSearchPattern(params.search);
  const pageSize = clampPageSize(params.pageSize);
  const requestedPage = clampRequestedPage(params.page);

  const rosterParams: RosterQueryParams = {
    allianceId,
    periodId,
    metricId,
    isBooleanMetric,
    filter,
    searchPattern,
  };

  // The visualization rows back SUM/AVERAGE/NONE+NUMERIC charts, which need
  // per-member values (see metricVisualModel.ts's builders). TRUE_RATE and
  // NONE+BOOLEAN instead read their visual model straight off `aggregate` —
  // deriving an unused per-member array for them would have no functional
  // benefit. This is a pure-JS skip now (#287 Slice 3 perf fix): the DB
  // fetch it used to also skip is shared with the aggregate below, so it
  // always runs exactly once regardless of this flag.
  const needsVisualizationRows =
    metric.summaryKind === MetricSummaryKind.SUM ||
    metric.summaryKind === MetricSummaryKind.AVERAGE ||
    (metric.summaryKind === MetricSummaryKind.NONE && !isBooleanMetric);

  const [{ values: primaryValues, roster: primaryRoster }, totalRowCount] = await Promise.all([
    fetchMemberPeriodValuesAndRoster(allianceId, periodId, metricId),
    countRosterRows(rosterParams),
  ]);
  const aggregate = computeAggregateSnapshot(primaryValues, primaryRoster, isBooleanMetric);
  const visualizationRows: VisualCohortRow[] = needsVisualizationRows
    ? deriveVisualizationRows(primaryValues, primaryRoster)
    : [];

  const page = resolvePageAgainstTotal(requestedPage, totalRowCount, pageSize);
  const offset = (page - 1) * pageSize;

  const rosterRows = await queryRosterRows(rosterParams, sort, pageSize, offset);

  const rollup = buildMetricRollup(metric.summaryKind, aggregate);

  const rows: MetricReportRow[] = rosterRows.map((row) =>
    buildMetricReportRow({
      allianceMemberId: row.alliance_member_id,
      playerName: row.player_name,
      archived: row.archived,
      value: row.value,
      rank: row.rank === null ? null : Number(row.rank),
      metricType: metric.type,
      summaryKind: metric.summaryKind,
      rollup,
    }),
  );

  const dataStatus: MetricPeriodDataStatus = aggregate.latestEntryCount > 0 ? "HAS_VALUES" : "NO_VALUES";

  const coverage: MetricCoverage = {
    currentActiveMemberCount: aggregate.currentActiveMemberCount,
    recordedActiveMemberCount: aggregate.recordedActiveMemberCount,
    invalidActiveMemberCount: aggregate.invalidActiveMemberCount,
    missingActiveMemberCount: aggregate.missingActiveMemberCount,
    complete: aggregate.missingActiveMemberCount === 0 && aggregate.invalidActiveMemberCount === 0,
    archivedContributingMemberCount: aggregate.archivedContributingMemberCount,
  };

  const periodInfo: PeriodInfo = {
    id: period.id,
    name: period.name,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    active: period.active,
  };

  const comparison = await buildComparisonSection({
    allianceId,
    metricId,
    isBooleanMetric,
    summaryKind: metric.summaryKind,
    selectedPeriod: periodInfo,
    selectedRollup: rollup,
    selectedDataStatus: dataStatus,
    comparePeriodId,
  });

  const visualModel = buildMetricVisualModel({
    summaryKind: metric.summaryKind,
    metricType: metric.type,
    rows: visualizationRows,
    aggregate,
  });

  const interpretationSummary = buildMetricInterpretationSummary({
    metricName: metric.name,
    unitLabel: metric.unitLabel,
    summaryKind: metric.summaryKind,
    metricType: metric.type,
    trendDirection: metric.trendDirection,
    attachmentStatus,
    dataStatus,
    rollup,
    coverage,
    comparison,
    visualModel,
  });

  return {
    metric: {
      id: metric.id,
      name: metric.name,
      type: metric.type,
      summaryKind: metric.summaryKind,
      unitLabel: metric.unitLabel,
      active: metric.active,
      trendDirection: metric.trendDirection,
    },
    period: periodInfo,
    attachmentStatus,
    dataStatus,
    rollup,
    coverage,
    comparison,
    visualModel,
    interpretationSummary,
    rows,
    pagination: { page, pageSize, totalRowCount },
    sort,
    filter,
    search: boundSearchInput(params.search),
  };
}
