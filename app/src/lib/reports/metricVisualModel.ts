import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import {
  buildMetricRollup,
  computeShareAvailability,
  type AggregateSnapshot,
  type MetricShareAvailability,
} from "@/app/src/lib/reports/metricRollup";

/**
 * Pure, discriminated visual-model builders for a metric's drill-down chart
 * (#264 PR4). Deliberately has no `server-only` dependency and no Prisma
 * import — this is consumed by `getMetricSummaryReport.ts` (which fetches
 * the bounded full-cohort rows below and feeds them in here) but must
 * remain safe to import from a future client chart component (PR5) without
 * repeating the `AllianceMemberMatrixControls.tsx` bundling failure from
 * PR3. See `metricRollup.ts` for why the rollup math it reuses lives in its
 * own server-agnostic module.
 *
 * `MetricVisualModel` is deliberately *not* the roster/report row shape —
 * it is a derived, bounded, per-chart-kind summary the page renders
 * directly, never an unbounded raw-member payload. Only `SUM`'s top 10
 * contributors carry member identity; `AVERAGE`, `TRUE_RATE`, and `NONE`
 * never do, even though the query that feeds this builder returns identity
 * for every row (needed to *rank* the top 10) — anonymizing the rest here,
 * once, in the pure layer, is safer than trusting every future caller to
 * remember not to render member names off an aggregate chart.
 */

/** The bounded full-cohort row shape `getMetricSummaryReport.ts`'s new visualization query returns — see its query builder for the exact inclusion rule. */
export type VisualCohortRow = {
  allianceMemberId: string;
  playerName: string;
  archived: boolean;
  /** Raw, unvalidated value — may be a legacy out-of-range boolean, preserved so TRUE_RATE/data-quality states stay honest. Null means no entry this period. */
  value: number | null;
};

export type DistributionBin = {
  rangeStart: number;
  rangeEnd: number;
  count: number;
};

export type SumTopContributor = {
  allianceMemberId: string;
  playerName: string;
  archived: boolean;
  value: number;
  /** Null exactly when the chart-wide `shareAvailability.available` is false — never computed per-bar independently of the whole. */
  percentageOfTotal: number | null;
};

export type SumVisualModel = {
  kind: "SUM";
  /** Whole-chart share availability (see `computeShareAvailability`) — one decision for every bar, not a per-member one. */
  shareAvailability: MetricShareAvailability;
  /**
   * Ordered desc by value; ties broken by playerName then allianceMemberId
   * (matches the roster's own tiebreak convention). Capped at 10. When the
   * cohort has negative values (see `shareAvailability`/diverging mode),
   * this is *not* a plain top-10-by-value slice — both signs are
   * guaranteed representation when present (see `selectTopContributorRows`).
   */
  topContributors: SumTopContributor[];
  /** How many members had a recorded value at all, for "top 10 of N contributors" framing. */
  consideredCount: number;
};

export type AverageVisualModel = {
  kind: "AVERAGE";
  /** Null only when there are zero valid results (mirrors `MetricRollup`'s AVERAGE shape). */
  average: number | null;
  /** Empty when `validCount === 0`; exactly one bin when every valid value is equal; otherwise `DISTRIBUTION_BIN_COUNT` equal-width bins. */
  bins: DistributionBin[];
  aboveAverageCount: number;
  belowAverageCount: number;
  atAverageCount: number;
  validCount: number;
};

export type TrueRateVisualModel = {
  kind: "TRUE_RATE";
  trueCount: number;
  falseCount: number;
  invalidCount: number;
  recordedActiveMemberCount: number;
  missingActiveMemberCount: number;
  currentActiveMemberCount: number;
};

export type NoneVisualModel =
  | {
      kind: "NONE";
      valueKind: "NUMERIC";
      bins: DistributionBin[];
      validCount: number;
    }
  | {
      kind: "NONE";
      valueKind: "BOOLEAN";
      trueCount: number;
      falseCount: number;
      invalidCount: number;
      recordedActiveMemberCount: number;
      missingActiveMemberCount: number;
      currentActiveMemberCount: number;
    };

/**
 * NONE never gains a rollup field of any kind (no total, no average, no
 * rate) — a NONE-kind metric has, by product definition, no alliance-wide
 * rollup. This type only ever describes the shape of the raw member-level
 * data, never a fabricated summary of it.
 */
export type MetricVisualModel = SumVisualModel | AverageVisualModel | TrueRateVisualModel | NoneVisualModel;

/**
 * Deliberately fixed rather than adaptive (e.g. Sturges' rule) — a constant
 * bin count keeps binning fully deterministic across environments/floating
 * point, and mid-range of the product's "5–7 bins" target. The all-equal
 * and zero-data cases below are the only departures from this constant.
 */
export const DISTRIBUTION_BIN_COUNT = 6;

/**
 * Buckets a set of valid numeric values into `DISTRIBUTION_BIN_COUNT`
 * equal-width bins spanning [min, max], with two explicit special cases:
 *   - zero values -> no bins (nothing to show).
 *   - every value identical -> exactly one bin (an equal-width split of a
 *     zero-width range is undefined, and would misleadingly suggest
 *     variation that doesn't exist).
 * The last bin's upper bound is always exactly `max` (rather than
 * `min + binCount*width`, which float division can overshoot or undershoot
 * by an epsilon), and membership uses `value === max` as an explicit
 * escape hatch into the last bin for the same reason.
 */
export function buildDistributionBins(values: number[]): DistributionBin[] {
  if (values.length === 0) return [];
  // Iterative rather than `Math.min(...values)` / `Math.max(...values)`:
  // spreading the full cohort into function arguments risks a
  // call-stack/argument-limit failure at large cohort sizes.
  let min = values[0]!;
  let max = values[0]!;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) {
    return [{ rangeStart: min, rangeEnd: max, count: values.length }];
  }

  const binCount = DISTRIBUTION_BIN_COUNT;
  const width = (max - min) / binCount;
  const bins: DistributionBin[] = Array.from({ length: binCount }, (_, index) => ({
    rangeStart: min + index * width,
    rangeEnd: index === binCount - 1 ? max : min + (index + 1) * width,
    count: 0,
  }));

  for (const value of values) {
    const index = value >= max ? binCount - 1 : Math.floor((value - min) / width);
    bins[Math.min(Math.max(index, 0), binCount - 1)]!.count += 1;
  }

  return bins;
}

function rowValue(row: VisualCohortRow): number | null {
  return row.value;
}

function sortedByValueDesc(rows: VisualCohortRow[]): Array<VisualCohortRow & { value: number }> {
  return rows
    .filter((row): row is VisualCohortRow & { value: number } => row.value !== null)
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      // Explicit locale ("en") rather than the runtime default: an
      // unspecified locale can collate differently across environments,
      // which would make this tie-break — and therefore top-10 membership
      // for exact ties — nondeterministic.
      if (a.playerName !== b.playerName) return a.playerName.localeCompare(b.playerName, "en");
      return a.allianceMemberId.localeCompare(b.allianceMemberId, "en");
    });
}

const SUM_TOP_CONTRIBUTOR_LIMIT = 10;
const SUM_TOP_CONTRIBUTOR_HALF = Math.floor(SUM_TOP_CONTRIBUTOR_LIMIT / 2);

/**
 * A plain top-N-by-value slice is correct whenever the chart shows a simple
 * ranked bar list (`hasNegativeValues` false). But once the chart is in
 * diverging/raw mode (`hasNegativeValues` true — see `computeShareAvailability`),
 * a plain top-N would silently drop every negative contributor whenever
 * `SUM_TOP_CONTRIBUTOR_LIMIT` or more positive values exist, defeating the
 * point of showing both directions. This reserves half the slots for the
 * most-positive and half for the most-negative contributors, then backfills
 * any unused half from whichever side has more, so the total selected is
 * still exactly `SUM_TOP_CONTRIBUTOR_LIMIT` (or the whole cohort, if
 * smaller) — while both signs are guaranteed representation when present.
 * `ranked` is already sorted desc by value (see `sortedByValueDesc`), so the
 * result below preserves that same order (positives high-to-low, then
 * negatives high-to-low) rather than grouping by sign.
 */
function selectTopContributorRows(
  ranked: Array<VisualCohortRow & { value: number }>,
  hasNegativeValues: boolean,
): Array<VisualCohortRow & { value: number }> {
  if (!hasNegativeValues) {
    return ranked.slice(0, SUM_TOP_CONTRIBUTOR_LIMIT);
  }

  const positives = ranked.filter((row) => row.value >= 0);
  const negatives = ranked.filter((row) => row.value < 0);

  const selectedPositives = positives.slice(0, SUM_TOP_CONTRIBUTOR_HALF);
  const negativeSlots = SUM_TOP_CONTRIBUTOR_LIMIT - selectedPositives.length;
  const selectedNegatives = negatives.slice(0, negativeSlots);
  const backfillSlots = SUM_TOP_CONTRIBUTOR_LIMIT - selectedPositives.length - selectedNegatives.length;
  const backfillPositives =
    backfillSlots > 0 ? positives.slice(selectedPositives.length, selectedPositives.length + backfillSlots) : [];

  const selectedIds = new Set(
    [...selectedPositives, ...selectedNegatives, ...backfillPositives].map((row) => row.allianceMemberId),
  );
  return ranked.filter((row) => selectedIds.has(row.allianceMemberId));
}

/**
 * Chart-wide share availability is computed once from the rollup itself
 * (never per-row) — `computeShareAvailability`'s decision only depends on
 * `rollup.total`/`rollup.hasNegativeValues`, so the specific value passed
 * in doesn't change the availability verdict. Passing the total itself
 * keeps the call self-explanatory (asking "what share is the total of
 * itself" trivially resolves to 100% when available).
 */
function buildSumVisualModel(rows: VisualCohortRow[], aggregate: AggregateSnapshot): SumVisualModel {
  const rollup = buildMetricRollup(MetricSummaryKind.SUM, aggregate);
  if (rollup.kind !== "SUM") {
    // Unreachable: `buildMetricRollup` always returns a SUM-kind rollup for
    // a SUM `MetricSummaryKind` argument — this narrows the union type for
    // TypeScript, matching `buildBaselineFacts`' own narrowing checks.
    throw new Error("buildSumVisualModel: expected a SUM rollup");
  }
  // Always non-null: `rollup` was just built as a SUM rollup above, and
  // `computeShareAvailability` only returns null for a non-SUM rollup kind.
  const shareAvailability = computeShareAvailability(aggregate.sumValue, rollup)!;

  const ranked = sortedByValueDesc(rows);
  const selected = selectTopContributorRows(ranked, rollup.hasNegativeValues);
  const topContributors: SumTopContributor[] = selected.map((row) => {
    const share = computeShareAvailability(row.value, rollup);
    return {
      allianceMemberId: row.allianceMemberId,
      playerName: row.playerName,
      archived: row.archived,
      value: row.value,
      percentageOfTotal: share?.available ? share.percentageOfTotal : null,
    };
  });

  return {
    kind: "SUM",
    shareAvailability,
    topContributors,
    consideredCount: ranked.length,
  };
}

function buildAverageVisualModel(rows: VisualCohortRow[], aggregate: AggregateSnapshot): AverageVisualModel {
  const validValues = rows.map(rowValue).filter((value): value is number => value !== null);
  const average = aggregate.averageValue;
  const bins = buildDistributionBins(validValues);

  let aboveAverageCount = 0;
  let belowAverageCount = 0;
  let atAverageCount = 0;
  if (average !== null) {
    for (const value of validValues) {
      if (value > average) aboveAverageCount += 1;
      else if (value < average) belowAverageCount += 1;
      else atAverageCount += 1;
    }
  }

  return {
    kind: "AVERAGE",
    average,
    bins,
    aboveAverageCount,
    belowAverageCount,
    atAverageCount,
    validCount: validValues.length,
  };
}

/**
 * Sourced from the already-computed, already-tested full-cohort aggregate
 * rather than re-deriving true/false/invalid/coverage counts from `rows` —
 * one source of truth for these counts, matching `NONE`+BOOLEAN below.
 */
function buildTrueRateVisualModel(aggregate: AggregateSnapshot): TrueRateVisualModel {
  return {
    kind: "TRUE_RATE",
    trueCount: aggregate.trueCount,
    falseCount: aggregate.falseCount,
    invalidCount: aggregate.invalidCount,
    recordedActiveMemberCount: aggregate.recordedActiveMemberCount,
    missingActiveMemberCount: aggregate.missingActiveMemberCount,
    currentActiveMemberCount: aggregate.currentActiveMemberCount,
  };
}

function buildNoneVisualModel(
  metricType: Metric_Type,
  rows: VisualCohortRow[],
  aggregate: AggregateSnapshot,
): NoneVisualModel {
  if (metricType === Metric_Type.BOOLEAN) {
    return {
      kind: "NONE",
      valueKind: "BOOLEAN",
      trueCount: aggregate.trueCount,
      falseCount: aggregate.falseCount,
      invalidCount: aggregate.invalidCount,
      recordedActiveMemberCount: aggregate.recordedActiveMemberCount,
      missingActiveMemberCount: aggregate.missingActiveMemberCount,
      currentActiveMemberCount: aggregate.currentActiveMemberCount,
    };
  }

  const validValues = rows.map(rowValue).filter((value): value is number => value !== null);
  return {
    kind: "NONE",
    valueKind: "NUMERIC",
    bins: buildDistributionBins(validValues),
    validCount: validValues.length,
  };
}

/**
 * The single entry point the read model calls after fetching the bounded
 * full-cohort rows. `rows` drives `SUM`/`AVERAGE`/`NONE`+NUMERIC (which need
 * per-member values); `TRUE_RATE`/`NONE`+BOOLEAN instead reuse `aggregate`
 * directly, since it already has the exact same true/false/invalid/coverage
 * counts computed and tested independently — recomputing them from `rows`
 * here would be a second, riskier source of truth for the same numbers.
 */
export function buildMetricVisualModel(params: {
  summaryKind: MetricSummaryKind;
  metricType: Metric_Type;
  rows: VisualCohortRow[];
  aggregate: AggregateSnapshot;
}): MetricVisualModel {
  const { summaryKind, metricType, rows, aggregate } = params;
  switch (summaryKind) {
    case MetricSummaryKind.SUM:
      return buildSumVisualModel(rows, aggregate);
    case MetricSummaryKind.AVERAGE:
      return buildAverageVisualModel(rows, aggregate);
    case MetricSummaryKind.TRUE_RATE:
      return buildTrueRateVisualModel(aggregate);
    case MetricSummaryKind.NONE:
    default:
      return buildNoneVisualModel(metricType, rows, aggregate);
  }
}
