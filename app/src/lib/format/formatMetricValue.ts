import { formatPower } from "@/app/src/lib/formatPower";

export type FormattedMetricValue = {
  /** Compact display string (e.g. "45.2M pts"). */
  compact: string;
  /** Exact, locale-formatted value with no unit, for a title/tooltip attribute. */
  exact: string;
};

/**
 * Formats a raw per-member value or a SUM rollup total (#190) for compact
 * display, reusing formatPower's K/M/G/T compaction. Compact display alone
 * can make visually distinct values indistinguishable (999,950 and
 * 1,000,000 both render "1M"), so this always also returns the exact
 * locale-formatted value for a `title`/tooltip attribute — callers should
 * render both, never `compact` alone.
 *
 * Null handling is the caller's responsibility (matches the existing
 * `value == null ? "—" : formatPower(value)` convention used elsewhere in
 * the app), since "missing" is a report-specific concept this formatter has
 * no business modeling.
 */
export function formatMetricValue(value: number, unitLabel?: string | null): FormattedMetricValue {
  const compactNumber = formatPower(value);
  return {
    compact: unitLabel ? `${compactNumber} ${unitLabel}` : compactNumber,
    // Explicit locale ("en-US") rather than the runtime default: an
    // unspecified locale renders differently across environments (e.g. a
    // decimal comma instead of a thousands comma), which would make the
    // deterministic interpretation summary's exact wording
    // (`metricInterpretationSummary.ts`) nondeterministic across servers.
    exact: value.toLocaleString("en-US"),
  };
}
