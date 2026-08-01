/**
 * Pure competition-ranking reference implementation (#190).
 *
 * This is a **test oracle only** — the actual metric summary report ranks
 * rows in SQL via `RANK() OVER (ORDER BY value DESC)` (see
 * getMetricSummaryReport.ts), computed over the full cohort before any
 * display filter/pagination is applied. This module exists purely so that
 * SQL behavior (ties share a rank; the next distinct value's rank skips by
 * the tied group's size — i.e. 1, 2, 2, 4, not 1, 2, 2, 3) can be asserted
 * against a plain-object reference in unit tests, without a database.
 *
 * Callers must exclude missing/invalid values *before* calling this — it
 * ranks exactly the rows it's given, with no awareness of "missing" or
 * "invalid" as concepts (matching the SQL CTE's `WHERE value IS NOT NULL`
 * filter, which happens before the window function runs).
 */
export type RankableMetricRow = {
  memberId: string;
  value: number;
};

export type RankedMetricRow = RankableMetricRow & {
  rank: number;
};

export function rankMetricRows(rows: readonly RankableMetricRow[]): RankedMetricRow[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value);

  const ranked: RankedMetricRow[] = [];
  let currentRank = 0;
  let previousValue: number | null = null;

  sorted.forEach((row, index) => {
    if (previousValue === null || row.value !== previousValue) {
      currentRank = index + 1;
      previousValue = row.value;
    }
    ranked.push({ ...row, rank: currentRank });
  });

  return ranked;
}
