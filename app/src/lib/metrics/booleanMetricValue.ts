/**
 * The single definition of "what counts as a valid BOOLEAN-metric value"
 * (#190). Reused by every write path (manual recording, single-period
 * import, multi-period import) to reject anything other than exactly `0` or
 * `1`, and by the metric summary report's read model to classify legacy rows
 * written before this guard existed as `INVALID` rather than silently
 * coercing them.
 */
export function isValidBooleanMetricValue(value: number): boolean {
  return value === 0 || value === 1;
}
