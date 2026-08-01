/**
 * Rounds symmetrically for positive and negative values (half away from
 * zero on both sides). Plain `Math.round` rounds negative half-ties toward
 * zero while positive half-ties round away from zero (e.g. `-1.005` →
 * `-1.00` but a hypothetical exact `1.005` → `1.01`), which would make an
 * equal-magnitude gain and loss (e.g. differenceFromAverage) render with
 * different magnitudes.
 */
function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/**
 * Precision-preserving formatting for an AVERAGE rollup or a
 * differenceFromAverage (#190) — deliberately not compacted through
 * formatPower's K/M/G/T suffixes, since averages/differences are typically
 * small numbers where a couple decimal places of precision matter more than
 * compaction. Renders up to 2 decimal places, trimmed to a whole number when
 * the value has none.
 */
export function formatMetricAverage(value: number, unitLabel?: string | null): string {
  const rounded = roundToDecimals(value, 2);
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return unitLabel ? `${formatted} ${unitLabel}` : formatted;
}
