/**
 * Pure numeric-distribution math for the APS data-readiness audit (#284 PR
 * A): given a metric's valid, active-member values for one period, compute
 * the shape statistics the evidence report needs (min/max, quantiles,
 * zero/negative counts, outlier count). Deliberately Prisma-free so this is
 * unit-testable on plain arrays; `apsDataReadinessAudit.ts` supplies the
 * values (already resolved to "latest entry per member," matching Reports'
 * semantics) and applies small-cell suppression to the result.
 */

export type NumericDistribution = {
  count: number;
  min: number;
  max: number;
  /** Linear-interpolation percentiles, matching PostgreSQL's `percentile_cont` default method. */
  p25: number;
  p50: number;
  p75: number;
  zeroCount: number;
  negativeCount: number;
  /** Values outside [p25 - 1.5*IQR, p75 + 1.5*IQR] — the standard Tukey fence, not a leadership judgment. */
  outlierCount: number;
};

/** Linear-interpolation percentile over an already-sorted ascending array (PostgreSQL `percentile_cont` semantics). */
function percentileContSorted(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const rank = fraction * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  if (lowerIndex === upperIndex) return lower;
  const weight = rank - lowerIndex;
  return lower + (upper - lower) * weight;
}

export function computeNumericDistribution(values: readonly number[]): NumericDistribution | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const p25 = percentileContSorted(sorted, 0.25);
  const p50 = percentileContSorted(sorted, 0.5);
  const p75 = percentileContSorted(sorted, 0.75);
  const iqr = p75 - p25;
  const lowerFence = p25 - 1.5 * iqr;
  const upperFence = p75 + 1.5 * iqr;

  let zeroCount = 0;
  let negativeCount = 0;
  let outlierCount = 0;
  for (const value of values) {
    if (value === 0) zeroCount += 1;
    if (value < 0) negativeCount += 1;
    if (value < lowerFence || value > upperFence) outlierCount += 1;
  }

  return {
    count: values.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p25,
    p50,
    p75,
    zeroCount,
    negativeCount,
    outlierCount,
  };
}
