import { roundToDecimals } from "@/app/src/lib/format/roundToDecimals";

export type PercentUnit = "%" | "pp";

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
