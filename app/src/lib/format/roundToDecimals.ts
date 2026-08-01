/**
 * Rounds symmetrically for positive and negative values (half away from
 * zero on both sides). Plain `Math.round` rounds negative half-ties toward
 * zero while positive half-ties round away from zero (e.g. `-4.55` → `-4.5`
 * but `4.55` → `4.6`), which would make an equal-magnitude gain and loss
 * (a percentage change, or a differenceFromAverage) render with different
 * magnitudes. Shared by `formatPercent` and `formatMetricAverage` (#190) so
 * the rounding rule can't accidentally diverge between the two.
 */
export function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}
