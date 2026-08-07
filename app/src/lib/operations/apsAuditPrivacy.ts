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

/**
 * Coarsens a single alliance-configuration count (period counts, metric
 * type/summary/direction/attachment counts, weight-component counts,
 * stability-change counts, dogfood counts) rather than a member-derived
 * one -- these describe the alliance's own setup, not any individual's
 * behavior, so `suppressCorrelatedCounts`'s member-privacy bundling
 * doesn't apply. They're rendered as a coarse range instead of an exact
 * number specifically to avoid a sparse configuration acting as a
 * re-identifying fingerprint for an otherwise-pseudonymous alliance (a
 * DIFFERENT concern from small-cell member suppression -- see the
 * `apsAuditReportFormat.ts` module doc comment).
 *
 * `0` is rendered exactly (it's not a "small identifiable group," it's an
 * absence), and so is anything >= `minCellSize`; only a positive count
 * below the threshold is replaced with a `1-(minCellSize - 1)` range.
 *
 * NOTE: coarsening one field in a set that sums to an exactly-known total
 * does not, by itself, make the coarsened field unrecoverable by
 * arithmetic against the other (exact) fields in the same set. This is a
 * good-faith reduction in casual precision, not a cryptographic guarantee
 * -- see the report's `limitations` list.
 */
export function coarsenSmallCount(n: number, minCellSize: number = MIN_CELL_SIZE): string {
  if (n > 0 && n < minCellSize) {
    return `1-${minCellSize - 1}`;
  }
  return String(n);
}

/**
 * Coarsens a *named bundle* of alliance-configuration counts TOGETHER,
 * rather than each one independently -- the same closed-sum problem
 * `suppressCorrelatedCounts` solves for member-derived statistics also
 * applies here: several of these counts are exact breakdowns of (or
 * otherwise exactly derivable from) each other (e.g. `byType` values sum to
 * `totalMetricCount`; duration buckets sum to `periodsWithBothDatesCount`).
 * Independently coarsening only the small ones while leaving the total and
 * the other categories exact lets a reader recover the coarsened value(s)
 * by subtraction -- exactly the gap `coarsenSmallCount` alone does not
 * close for a *group* of related counts.
 *
 * Unlike `coarsenSmallCount` (which returns a `1-(minCellSize-1)` range for
 * a single small count), this returns the SAME opaque "suppressed" marker
 * for every member of the bundle once ANY of them is risky -- there is no
 * safe partial disclosure once one member of a closed-sum group is small,
 * because the others (however they're rendered) combined with a still-exact
 * total would still pin it down. Either every count in the bundle is safe
 * to show exactly (0, or >= `minCellSize`), or none of them are shown at
 * all.
 *
 * EQUATION-AWARE: checking each raw value alone is not enough. Two values
 * that are each individually safe (0 or >= `minCellSize`) can still be
 * close enough together that their DIFFERENCE discloses a small derived
 * complement -- e.g. `total=20`/`enough=19` never trips a per-value check,
 * but `total - enough = 1` (an exact "1 not-ready" count) is exactly the
 * kind of small subgroup this function exists to hide. So every pairwise
 * absolute difference within the bundle is checked too, not just the raw
 * values. This is deliberately a conservative, general rule rather than
 * per-bundle equation modeling: it catches every real complement in a
 * bundle without the caller having to declare which pairs are "really"
 * related by subtraction, at the cost of occasionally suppressing a bundle
 * over a coincidental (not domain-meaningful) closeness between two
 * unrelated members -- an acceptable false positive given the alternative
 * is a missed disclosure.
 */
export function coarsenCorrelatedCounts<K extends string>(
  counts: Record<K, number>,
  minCellSize: number = MIN_CELL_SIZE,
): Record<K, string> {
  const entries = Object.entries(counts) as [K, number][];
  const values = entries.map(([, n]) => n);
  const isRisky = (n: number) => n > 0 && n < minCellSize;

  const anyValueRisky = values.some(isRisky);
  const anyComplementRisky = values.some((a, i) => values.some((b, j) => j > i && isRisky(Math.abs(a - b))));

  if (!anyValueRisky && !anyComplementRisky) {
    return Object.fromEntries(entries.map(([key, n]) => [key, String(n)])) as Record<K, string>;
  }
  const suppressedLabel = `suppressed (cell size < ${minCellSize})`;
  return Object.fromEntries(entries.map(([key]) => [key, suppressedLabel])) as Record<K, string>;
}
