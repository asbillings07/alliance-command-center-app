import type { DistributionBin, SumTopContributor } from "@/app/src/lib/reports/metricVisualModel";
import type { MetricShareAvailability } from "@/app/src/lib/reports/metricRollup";
import { formatMetricValue } from "@/app/src/lib/format/formatMetricValue";
import { formatMetricAverage } from "@/app/src/lib/format/formatMetricAverage";

/**
 * Pure formatting/derivation helpers shared by the metric drill-down's
 * accessible chart components (#264 PR5). Kept separate from JSX so the
 * boundary-precision and mode-classification logic — the parts most worth
 * unit-testing directly, without rendering — has its own file, matching
 * the `reportRowDisplay.ts` / `reportRollupDisplay.ts` precedent.
 */

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * SUM's diverging-mode sub-treatment (#264 PR5 spec). Only ever called when
 * `shareAvailability.available === false` — `NON_POSITIVE_TOTAL` only
 * occurs when every value is non-negative and the total is <= 0, which,
 * combined with "non-negative", means every value is exactly zero (or the
 * cohort is empty). `NEGATIVE_VALUES_PRESENT` still needs its own
 * mixed-vs-all-negative split (mirrors `metricInterpretationSummary.ts`'s
 * SUM fix): a cohort with no positive value at all should never render as
 * if it were "mixed".
 */
export type SumDivergingMode = "MIXED" | "ALL_NEGATIVE" | "ALL_ZERO";

export function classifySumDivergingMode(
  shareAvailability: Extract<MetricShareAvailability, { available: false }>,
  topContributors: SumTopContributor[],
): SumDivergingMode {
  if (shareAvailability.reason === "NON_POSITIVE_TOTAL") return "ALL_ZERO";
  const hasPositive = topContributors.some((contributor) => contributor.value > 0);
  return hasPositive ? "MIXED" : "ALL_NEGATIVE";
}

/** The largest absolute value among the selected contributors — the diverging plot's scale, per the spec's "scale from the most-negative selected value to zero" (ALL_NEGATIVE) / symmetric domain (MIXED). Zero when every value is zero (ALL_ZERO, where no plot renders anyway). */
export function maxAbsoluteContributorValue(topContributors: SumTopContributor[]): number {
  return topContributors.reduce((max, c) => Math.max(max, Math.abs(c.value)), 0);
}

/**
 * "+120 pts" / "-35 pts" / "0 pts" — an explicit sign character on every
 * non-zero row (never solely a bar's direction), per the spec. Negative
 * values already carry `-` from `toLocaleString`; only positive needs one
 * added.
 */
export function formatSignedMetricValue(value: number, unitLabel: string | null): string {
  const exact = formatMetricValue(value, null).exact;
  const signed = value > 0 ? `+${exact}` : exact;
  return unitLabel ? `${signed} ${unitLabel}` : signed;
}

/**
 * Deterministic decimal precision for a set of histogram bin boundaries —
 * the smallest precision (0..4) at which every boundary renders as a
 * distinct string, so two adjacent bins never both display the same
 * rounded number (e.g. a narrow [7.001, 7.003) bin rounding to the same
 * "7" as its neighbor). Falls back to 4 (matching the cap) in the
 * practically-impossible case where distinct floats still collide there.
 */
export function pickHistogramBoundaryPrecision(bins: DistributionBin[]): number {
  if (bins.length === 0) return 0;
  const boundaries = [bins[0]!.rangeStart, ...bins.map((bin) => bin.rangeEnd)];
  for (let precision = 0; precision <= 4; precision++) {
    const rendered = boundaries.map((value) => value.toFixed(precision));
    if (new Set(rendered).size === rendered.length) return precision;
  }
  return 4;
}

export function formatHistogramBoundary(value: number, precision: number, unitLabel: string | null): string {
  const exact = value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return unitLabel ? `${exact} ${unitLabel}` : exact;
}

/**
 * "0 ≤ value < 10" for every bin except the last, which is "≤" on both
 * ends (the last bin's upper bound is inclusive — see `buildDistributionBins`
 * in `metricVisualModel.ts`) — never ambiguous about which bin a boundary
 * value itself belongs to.
 */
export function formatBinRangeLabel(
  bin: DistributionBin,
  isLast: boolean,
  precision: number,
  unitLabel: string | null,
): string {
  const start = formatHistogramBoundary(bin.rangeStart, precision, unitLabel);
  const end = formatHistogramBoundary(bin.rangeEnd, precision, unitLabel);
  return isLast ? `${start} ≤ value ≤ ${end}` : `${start} ≤ value < ${end}`;
}

/** "Average: 7.4 pts" — same rounding/formatting convention as the rollup card's own average display. */
export function formatAverageMarkerLabel(average: number, unitLabel: string | null): string {
  return `Average: ${formatMetricAverage(average, unitLabel)}`;
}
