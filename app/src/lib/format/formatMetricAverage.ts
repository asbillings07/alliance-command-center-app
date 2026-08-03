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
  // Explicit locale ("en-US") rather than the runtime default: an
  // unspecified locale renders differently across environments, which
  // would make the deterministic interpretation summary's exact wording
  // (`metricInterpretationSummary.ts`) nondeterministic across servers.
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return unitLabel ? `${formatted} ${unitLabel}` : formatted;
}
