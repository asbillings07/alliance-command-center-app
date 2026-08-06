/**
 * Pure privacy rules for the APS data-readiness audit (#284 PR A): the
 * report this audit produces is deliberately not "just aggregate" —
 * min/max, quantiles, and any per-metric breakdown drawn from a small
 * cohort can still expose an individual value. These are deliberately
 * Prisma-free so the rules themselves are unit-testable on plain data.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Below this many contributing rows, a statistic is suppressed rather than shown exactly. */
export const MIN_CELL_SIZE = 5;

/**
 * Deterministic pseudonymous labels ("Alliance A", "Alliance B", ...),
 * assigned by sorting the alliance ids themselves — never by name, never by
 * insertion order (which could otherwise leak "this was the first alliance
 * in the allowlist" information). Only the label is ever included in the
 * audit's output; `allianceIds` are used solely to correlate query results
 * before the report is assembled.
 */
export function assignPseudonymousAllianceLabels(allianceIds: readonly string[]): Map<string, string> {
  const sorted = [...allianceIds].sort();
  const labels = new Map<string, string>();
  sorted.forEach((id, index) => {
    labels.set(id, allianceLabelForIndex(index));
  });
  return labels;
}

/** "A".."Z", then "AA".."AZ", "BA".."BZ", ... — supports allowlists larger than 26 without collisions. */
function allianceLabelForIndex(index: number): string {
  let n = index;
  let label = "";
  do {
    label = ALPHABET[n % 26] + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Alliance ${label}`;
}

/**
 * Metric labels are scoped *within* one alliance's label ("Alliance A /
 * Metric 1") and are assigned by sorting metric ids — never the metric's
 * real (possibly leader-chosen, potentially identifying) name, which is
 * never included in the audit's output at all.
 */
export function assignPseudonymousMetricLabels(metricIds: readonly string[]): Map<string, string> {
  const sorted = [...metricIds].sort();
  const labels = new Map<string, string>();
  sorted.forEach((id, index) => labels.set(id, `Metric ${index + 1}`));
  return labels;
}

export type SuppressibleStatistic<T> =
  | { suppressed: false; value: T }
  | { suppressed: true; cellSize: number; minCellSize: number };

/**
 * Suppress (rather than coarsen) any statistic computed from fewer than
 * `minCellSize` contributing rows. Coarsening (e.g. rounding) is not used
 * here because a coarsened min/max from a 1-2 row cohort can still be
 * reversed by a leader who already knows their own alliance's roster size —
 * suppression is the only safe default until a specific coarsening scheme
 * is separately reviewed.
 */
export function suppressSmallCell<T>(
  cellSize: number,
  value: T,
  minCellSize: number = MIN_CELL_SIZE,
): SuppressibleStatistic<T> {
  if (cellSize < minCellSize) {
    return { suppressed: true, cellSize, minCellSize };
  }
  return { suppressed: false, value };
}

/**
 * Suppresses a *bundle* of correlated counts together, rather than each one
 * independently. Independent suppression is unsafe whenever the counts are
 * linked by an exact relationship (e.g. `total = activeCount +
 * archivedCount`): if one of the three is hidden while the other two are
 * shown, the hidden one is trivially recoverable by subtraction, defeating
 * the suppression entirely.
 *
 * A count of exactly `0` is never itself treated as risky here -- "nobody"
 * (or, by extension via the other counts in the bundle, "everybody") isn't
 * a small identifiable group the way "1 to `minCellSize - 1`" is. Only a
 * *positive* count below `minCellSize` triggers suppression of the whole
 * bundle.
 */
export function suppressCorrelatedCounts<T>(
  counts: readonly number[],
  value: T,
  minCellSize: number = MIN_CELL_SIZE,
): SuppressibleStatistic<T> {
  const riskyCounts = counts.filter((count) => count > 0 && count < minCellSize);
  if (riskyCounts.length > 0) {
    return { suppressed: true, cellSize: Math.min(...riskyCounts), minCellSize };
  }
  return { suppressed: false, value };
}

/**
 * Renders a suppressed statistic without disclosing the exact suppressed
 * cell size -- "cell size < 5" only, never "cell size 2 < 5". The exact
 * count is itself information about a small, potentially identifiable
 * cohort (e.g. "exactly 2 of this alliance's members recorded a value"),
 * so it must never reach this audit's printed output even inside the
 * "suppressed" message meant to explain the redaction.
 */
export function formatSuppressibleStatistic<T>(stat: SuppressibleStatistic<T>, format: (value: T) => string): string {
  if (stat.suppressed) {
    return `suppressed (cell size < ${stat.minCellSize})`;
  }
  return format(stat.value);
}
