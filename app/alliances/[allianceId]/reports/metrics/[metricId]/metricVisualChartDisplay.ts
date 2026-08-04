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
 * "1,234 pts" — the accessible table's authoritative, unrounded value.
 * `formatMetricValue`'s `.compact` field (e.g. "1.2K") is fine for the
 * space-constrained visual bars, always paired there with a `title`
 * tooltip carrying the exact value — but the table *is* the accessible
 * representation itself, with no tooltip fallback. Rendering `.compact`
 * there can silently collapse two genuinely different values (999,950 and
 * 1,000,000 both display "1M"), per `formatMetricValue`'s own doc comment.
 */
export function formatExactMetricValue(value: number, unitLabel: string | null): string {
  const exact = formatMetricValue(value, null).exact;
  return unitLabel ? `${exact} ${unitLabel}` : exact;
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

/**
 * Roughly 1 glyph-width per 5.5 SVG units at the marker label's 10px font
 * size. This is only a *starting estimate* for how wide the label would
 * render naturally — unitLabel is arbitrary user text up to
 * `METRIC_UNIT_LABEL_MAX_LENGTH` (24) characters, and a per-character
 * average can't bound the true rendered width of unknown glyphs (24 wide
 * characters can render considerably wider than 24 narrow ones). The actual
 * no-clipping guarantee below does not depend on this number being
 * accurate — see `clampAverageMarkerLabelPosition`.
 */
const AVERAGE_MARKER_CHAR_WIDTH = 5.5;

export type AverageMarkerLabelPosition = {
  x: number;
  textAnchor: "start" | "middle" | "end";
  /**
   * Forces the *rendered* width of the `<text>` element via SVG's
   * `textLength` (paired with `lengthAdjust="spacingAndGlyphs"` on the
   * caller's `<text>`), independent of the label's actual glyph widths.
   * This is what makes the guarantee hold regardless of font metrics or
   * unitLabel content — `x`/`textAnchor` are computed against this exact
   * number, not the estimate that produced it, so even if the estimate
   * badly undershoots a wide-glyph label's true natural width, the browser
   * compresses it to fit `textLength` instead of overflowing.
   */
  textLength: number;
};

/**
 * Clamps the average marker's text label to stay within the SVG's
 * horizontal bounds, *provably* — not just "in the common case." The
 * marker *line* always sits at the mathematically exact average position;
 * the *label* gets both a safe anchor/x (below) and a hard `textLength` cap
 * so the browser never renders it wider than the space actually reserved
 * for it, however wide its real glyphs turn out to be.
 */
export function clampAverageMarkerLabelPosition(
  markerX: number,
  label: string,
  viewboxWidth: number,
  padding: number,
): AverageMarkerLabelPosition {
  const safeMaxWidth = viewboxWidth - 2 * padding;
  const estimatedWidth = label.length * AVERAGE_MARKER_CHAR_WIDTH;
  // Capping to safeMaxWidth here — not just using the estimate — is what
  // keeps the guarantee independent of the estimate's accuracy: whatever
  // width the browser is told to render (via textLength below), it is
  // never more than what's actually available in the viewBox.
  const textLength = Math.min(estimatedWidth, safeMaxWidth);
  const halfLabelWidth = textLength / 2;

  if (markerX - halfLabelWidth < padding) {
    return { x: padding, textAnchor: "start", textLength };
  }
  if (markerX + halfLabelWidth > viewboxWidth - padding) {
    return { x: viewboxWidth - padding, textAnchor: "end", textLength };
  }
  return { x: markerX, textAnchor: "middle", textLength };
}
