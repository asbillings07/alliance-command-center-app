import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";

/**
 * Pure rollup/aggregate types and math, deliberately split out of
 * `getMetricSummaryReport.ts` (#264 PR4) so it carries no `server-only`
 * dependency (transitively, via Prisma-typed raw-row shapes or the `prisma`
 * client import) and no `AllianceMemberMatrixControls.tsx`-style client
 * bundling risk. This is the shared "what does this metric's data actually
 * say" layer: `getMetricSummaryReport.ts` still owns fetching the rows,
 * `metricVisualModel.ts`'s pure per-summary-kind chart builders reuse this
 * file directly rather than depending on the server-only orchestration
 * module for a handful of already-pure functions. Matches the
 * `allianceMemberMatrix.ts` / `getAllianceMemberMetricMatrix.ts` split from
 * PR3.
 */

export type MetricShareAvailability =
  | { available: true; percentageOfTotal: number }
  | { available: false; reason: "NON_POSITIVE_TOTAL" | "NEGATIVE_VALUES_PRESENT" };

export type MetricRollup =
  | { kind: "SUM"; total: number; hasNegativeValues: boolean }
  | { kind: "AVERAGE"; average: number | null }
  | {
      kind: "TRUE_RATE";
      trueCount: number;
      falseCount: number;
      invalidCount: number;
      /** Percentage of valid (0/1) entries that were `1`. Null if none are valid. */
      trueRate: number | null;
    }
  | { kind: "NONE" };

export type BooleanRowStatus = "TRUE" | "FALSE" | "INVALID" | "MISSING";

export type MetricCoverage = {
  currentActiveMemberCount: number;
  recordedActiveMemberCount: number;
  invalidActiveMemberCount: number;
  missingActiveMemberCount: number;
  complete: boolean;
  /** Archived members who recorded a value this period, whether or not the current filter shows them. */
  archivedContributingMemberCount: number;
};

export type AggregateSnapshot = {
  sumValue: number;
  averageValue: number | null;
  trueCount: number;
  falseCount: number;
  invalidCount: number;
  hasNegativeValues: boolean;
  currentActiveMemberCount: number;
  recordedActiveMemberCount: number;
  invalidActiveMemberCount: number;
  missingActiveMemberCount: number;
  archivedContributingMemberCount: number;
  latestEntryCount: number;
};

/**
 * Structural, minimal input shapes for `computeAggregateSnapshot` —
 * deliberately not `MemberPeriodMetricValue`/the roster query's own return
 * type, so this file keeps its no-server-only-dependency guarantee (see the
 * module doc comment) without importing `memberPeriodMetricValues.ts` or
 * `prisma` at all. Both real call sites' richer types are structural
 * supersets of these, so no conversion is needed at either.
 */
export type AggregateValueInput = { allianceMemberId: string; value: number | null };
export type AggregateRosterInput = { id: string; archivedAt: Date | null };

/**
 * Derives the rollup + coverage aggregate for one metric from its
 * already-fetched per-member values (`memberPeriodMetricValues`, ADR-018
 * §6) and the alliance's member roster (both active and archived
 * contributors) — never against a filtered/paginated slice.
 *
 * #287 Slice 3: shared by `getMetricSummaryReport.ts` (one metric per call)
 * and `getAlliancePerformanceReport.ts` (called once per metric, grouping
 * a single multi-metric `memberPeriodMetricValues` call by `metricId`
 * first) — extracted here rather than duplicated, since the
 * boolean-validity/coverage-counting rules below are exactly the kind of
 * business logic AGENTS.md warns against hiding in two places that could
 * silently drift apart. Replaces both files' pre-#287 raw SQL
 * `DISTINCT ON` + `COUNT(*) FILTER (...)` aggregate queries, so a
 * `DAILY_OBSERVATION` metric's total correctly aggregates each member's
 * true rolled-up period value instead of their latest single day's raw
 * entry (inert today - no leader can create one yet; see
 * `docs/database-design/287-slice3-consumer-parity-log.md`).
 *
 * Every counter below replicates the old SQL's `FILTER` clause exactly,
 * field for field, to preserve the legacy invariant: `sum`/`average` only
 * include a *valid* value (boolean-checked when relevant); `hasNegativeValues`
 * and `latestEntryCount` check raw presence only, never boolean validity;
 * `archivedContributingMemberCount` counts *any* archived value, valid or
 * not.
 *
 * `sumValue`/`averageValue` are kept as exact (possibly fractional) sums,
 * not rounded to a whole number the way the old queries' `::bigint` cast
 * did — safe today, since `MemberMetricEntry.value` is an integer column so
 * every legacy per-member value is already whole, but correct-by-construction
 * once a `DAILY_OBSERVATION + AVERAGE` metric's fractional per-member value
 * (e.g. 12.5) needs to contribute an exact amount to a cohort-wide total,
 * rather than being silently rounded on the way in.
 */
export function computeAggregateSnapshot(
  values: readonly AggregateValueInput[],
  roster: readonly AggregateRosterInput[],
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
 * Builds the metric's configured rollup shape from a raw aggregate snapshot.
 * `summaryKind` alone decides the shape — the metric's `type` never leaks in
 * here, matching the (type, summaryKind) compatibility matrix that already
 * makes `SUM`/`AVERAGE` <-> NUMERIC and `TRUE_RATE` <-> BOOLEAN exclusive.
 */
export function buildMetricRollup(summaryKind: MetricSummaryKind, aggregate: AggregateSnapshot): MetricRollup {
  switch (summaryKind) {
    case MetricSummaryKind.SUM:
      return { kind: "SUM", total: aggregate.sumValue, hasNegativeValues: aggregate.hasNegativeValues };
    case MetricSummaryKind.AVERAGE:
      return { kind: "AVERAGE", average: aggregate.averageValue };
    case MetricSummaryKind.TRUE_RATE: {
      const validCount = aggregate.trueCount + aggregate.falseCount;
      return {
        kind: "TRUE_RATE",
        trueCount: aggregate.trueCount,
        falseCount: aggregate.falseCount,
        invalidCount: aggregate.invalidCount,
        trueRate: validCount > 0 ? (aggregate.trueCount / validCount) * 100 : null,
      };
    }
    case MetricSummaryKind.NONE:
    default:
      return { kind: "NONE" };
  }
}

/**
 * Percentage-of-total is only available when both the total is positive and
 * every valid value in the full cohort is non-negative. A single negative
 * value anywhere (e.g. member A: -10, member B: 110, total: 100) produces
 * mathematically valid but semantically misleading percentages, so it's
 * treated as unavailable rather than computed.
 */
export function computeShareAvailability(value: number, rollup: MetricRollup): MetricShareAvailability | null {
  if (rollup.kind !== "SUM") return null;
  if (rollup.hasNegativeValues) return { available: false, reason: "NEGATIVE_VALUES_PRESENT" };
  if (rollup.total <= 0) return { available: false, reason: "NON_POSITIVE_TOTAL" };
  return { available: true, percentageOfTotal: (value / rollup.total) * 100 };
}

export function computeDifferenceFromAverage(value: number, rollup: MetricRollup): number | null {
  if (rollup.kind !== "AVERAGE" || rollup.average === null) return null;
  return value - rollup.average;
}

export function computeBooleanRowStatus(value: number | null): BooleanRowStatus {
  if (value === null) return "MISSING";
  if (!isValidBooleanMetricValue(value)) return "INVALID";
  return value === 1 ? "TRUE" : "FALSE";
}

/**
 * Shapes one roster row into its final report form. Ranking is excluded for
 * TRUE_RATE (status only, not a competition) even though the SQL always
 * computes it for every metric with valid numeric values.
 */
export function buildMetricReportRow(params: {
  allianceMemberId: string;
  playerName: string;
  archived: boolean;
  value: number | null;
  rank: number | null;
  metricType: Metric_Type;
  summaryKind: MetricSummaryKind;
  rollup: MetricRollup;
}): {
  allianceMemberId: string;
  playerName: string;
  archived: boolean;
  value: number | null;
  rank: number | null;
  booleanStatus: BooleanRowStatus | null;
  share: MetricShareAvailability | null;
  differenceFromAverage: number | null;
} {
  const { allianceMemberId, playerName, archived, value, rank, metricType, summaryKind, rollup } = params;

  const booleanStatus = metricType === Metric_Type.BOOLEAN ? computeBooleanRowStatus(value) : null;
  const effectiveRank = summaryKind === MetricSummaryKind.TRUE_RATE ? null : rank;
  const share =
    summaryKind === MetricSummaryKind.SUM && value !== null ? computeShareAvailability(value, rollup) : null;
  const differenceFromAverage =
    summaryKind === MetricSummaryKind.AVERAGE && value !== null
      ? computeDifferenceFromAverage(value, rollup)
      : null;

  return {
    allianceMemberId,
    playerName,
    archived,
    value,
    rank: effectiveRank,
    booleanStatus,
    share,
    differenceFromAverage,
  };
}

/**
 * Period-over-period change, always computed from two independently-run
 * rollups (never derived arithmetically from raw per-row deltas). TRUE_RATE
 * expresses its change as a percentage-point difference via `absoluteChange`
 * — `percentageChange` (a "percent change of a percent") isn't meaningful
 * for a rate and is always null.
 */
export function computeRollupChange(
  summaryKind: MetricSummaryKind,
  selected: MetricRollup,
  comparison: MetricRollup,
): { absoluteChange: number | null; percentageChange: number | null } {
  if (summaryKind === MetricSummaryKind.SUM && selected.kind === "SUM" && comparison.kind === "SUM") {
    const absoluteChange = selected.total - comparison.total;
    const percentageChange = comparison.total > 0 ? (absoluteChange / comparison.total) * 100 : null;
    return { absoluteChange, percentageChange };
  }

  if (summaryKind === MetricSummaryKind.AVERAGE && selected.kind === "AVERAGE" && comparison.kind === "AVERAGE") {
    if (selected.average === null || comparison.average === null) {
      return { absoluteChange: null, percentageChange: null };
    }
    const absoluteChange = selected.average - comparison.average;
    const percentageChange = comparison.average > 0 ? (absoluteChange / comparison.average) * 100 : null;
    return { absoluteChange, percentageChange };
  }

  if (summaryKind === MetricSummaryKind.TRUE_RATE && selected.kind === "TRUE_RATE" && comparison.kind === "TRUE_RATE") {
    if (selected.trueRate === null || comparison.trueRate === null) {
      return { absoluteChange: null, percentageChange: null };
    }
    return { absoluteChange: selected.trueRate - comparison.trueRate, percentageChange: null };
  }

  return { absoluteChange: null, percentageChange: null };
}
