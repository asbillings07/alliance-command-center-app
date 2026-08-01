export type PercentUnit = "%" | "pp";

/**
 * Rounds symmetrically for positive and negative values (half away from
 * zero on both sides). Plain `Math.round` rounds negative half-ties toward
 * zero while positive half-ties round away from zero (e.g. `-4.55` → `-4.5`
 * but `4.55` → `4.6`), which would make an equal-magnitude percentage gain
 * and loss render with different magnitudes.
 */
function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/**
 * Formats a percentage-of-total, true rate, or period-over-period change
 * (#190). Always renders with a trailing `%` (share/rate) or `pp`
 * (percentage-point change for TRUE_RATE) — never a `unitLabel`, since
 * percentages are already unitless/normalized regardless of the underlying
 * metric's unit.
 *
 * `signed: true` prefixes a positive value with "+" (for period-over-period
 * changes, e.g. "+12.3%"); negative values already render their own "-" sign
 * via toLocaleString. Zero never gets a "+".
 */
export function formatPercent(
  value: number,
  options: { unit?: PercentUnit; signed?: boolean } = {},
): string {
  const { unit = "%", signed = false } = options;
  const rounded = roundToDecimals(value, 1);
  const sign = signed && rounded > 0 ? "+" : "";
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${sign}${formatted}${unit}`;
}
