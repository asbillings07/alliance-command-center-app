import { roundToDecimals } from "@/app/src/lib/format/roundToDecimals";

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
