/**
 * Pure period-over-period comparability rules for the metric summary report
 * (#190). Deliberately Prisma-free so eligibility and default-pick logic can
 * be unit-tested on plain objects; the read model (getMetricSummaryReport.ts)
 * supplies the candidate list (already scoped to the alliance and this
 * specific metric's MetricPeriodMetric attachment) and layers on the
 * data-availability check (NO_DATA_IN_COMPARISON_PERIOD), which requires a
 * DB query this module has no access to.
 *
 * Eligibility (all required):
 *   - The candidate has an ACTIVE MetricPeriodMetric attachment for this
 *     metric (a period the metric was never configured for, or was later
 *     deactivated on, is not a meaningful comparison baseline).
 *   - Both the selected period and the candidate have startsAt AND endsAt.
 *   - candidate.endsAt is strictly before selected.startsAt (period dates
 *     are read as inclusive elsewhere in the app, so a shared boundary day
 *     would mean the two periods overlap, not that one precedes the other).
 *   - The two periods have the same duration (endsAt - startsAt).
 */

export type ComparablePeriodCandidate = {
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  /** Whether this metric has an ACTIVE MetricPeriodMetric attachment on this period. */
  metricAttachedActive: boolean;
};

export type SelectedPeriodForComparison = {
  startsAt: Date | null;
  endsAt: Date | null;
};

export type EligiblePeriodOption = { id: string; name: string };

export function isEligibleComparisonPeriod(
  candidate: ComparablePeriodCandidate,
  selected: SelectedPeriodForComparison,
): boolean {
  if (!candidate.metricAttachedActive) return false;
  if (!selected.startsAt || !selected.endsAt) return false;
  if (!candidate.startsAt || !candidate.endsAt) return false;

  // Strict: a candidate ending on the same day the selected period starts
  // overlaps it, not precedes it.
  if (!(candidate.endsAt.getTime() < selected.startsAt.getTime())) return false;

  const candidateDuration = candidate.endsAt.getTime() - candidate.startsAt.getTime();
  const selectedDuration = selected.endsAt.getTime() - selected.startsAt.getTime();
  return candidateDuration === selectedDuration;
}

export function findEligibleComparisonPeriods<T extends ComparablePeriodCandidate>(
  candidates: readonly T[],
  selected: SelectedPeriodForComparison,
): T[] {
  return candidates.filter((candidate) => isEligibleComparisonPeriod(candidate, selected));
}

/** A missing date sorts as if it were infinitely old, rather than throwing. */
function timeOrMinInfinity(date: Date | null): number {
  return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

/**
 * Deterministic ordering for already-eligible candidates: latest startsAt
 * first, then endsAt desc, createdAt desc, id desc as pure tiebreakers —
 * never a comparability signal on their own (a candidate must already be
 * eligible to be sorted by this comparator). Shared by `pickDefaultComparisonPeriod`
 * (the recommended default) and `resolveComparisonPeriodSelection` (the full
 * `eligiblePeriods` list exposed to callers/UI), so the recommended period
 * and the option list it's drawn from can never disagree on ordering.
 *
 * `startsAt`/`endsAt` are null-safe (sorting last) even though every caller
 * in this module only ever sorts an already-`isEligibleComparisonPeriod`-filtered
 * list (which guarantees non-null dates) — `sortEligibleComparisonPeriods` is
 * exported and its type signature doesn't enforce that precondition, so a
 * misuse should degrade gracefully rather than throw.
 */
function compareEligibleCandidates(a: ComparablePeriodCandidate, b: ComparablePeriodCandidate): number {
  const startDiff = timeOrMinInfinity(b.startsAt) - timeOrMinInfinity(a.startsAt);
  if (startDiff !== 0) return startDiff;

  const endDiff = timeOrMinInfinity(b.endsAt) - timeOrMinInfinity(a.endsAt);
  if (endDiff !== 0) return endDiff;

  const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;

  return b.id.localeCompare(a.id);
}

export function sortEligibleComparisonPeriods<T extends ComparablePeriodCandidate>(
  eligible: readonly T[],
): T[] {
  return [...eligible].sort(compareEligibleCandidates);
}

export function pickDefaultComparisonPeriod<T extends ComparablePeriodCandidate>(
  eligible: readonly T[],
): T | null {
  if (eligible.length === 0) return null;
  return sortEligibleComparisonPeriods(eligible)[0]!;
}

function toOption(period: ComparablePeriodCandidate): EligiblePeriodOption {
  return { id: period.id, name: period.name };
}

export type ComparisonPeriodSelection =
  | { status: "NO_ELIGIBLE_PERIOD" }
  | {
      status: "INVALID_COMPARISON_PERIOD";
      requestedPeriodId: string;
      recommended: EligiblePeriodOption | null;
      eligiblePeriods: EligiblePeriodOption[];
    }
  | {
      status: "RESOLVED";
      period: EligiblePeriodOption;
      eligiblePeriods: EligiblePeriodOption[];
    };

/**
 * Resolve which comparison period (if any) applies, given an optional
 * caller-requested id. Never silently substitutes an explicit-but-ineligible
 * request — that returns INVALID_COMPARISON_PERIOD carrying the recommended
 * default so the UI can offer "use recommended" or canonicalize the URL,
 * rather than the request being treated as if it didn't come with an id at
 * all.
 */
export function resolveComparisonPeriodSelection(params: {
  requestedPeriodId?: string | null;
  candidates: readonly ComparablePeriodCandidate[];
  selected: SelectedPeriodForComparison;
}): ComparisonPeriodSelection {
  const { requestedPeriodId, candidates, selected } = params;
  const eligible = findEligibleComparisonPeriods(candidates, selected);
  const sortedEligible = sortEligibleComparisonPeriods(eligible);
  const eligibleOptions = sortedEligible.map(toOption);
  const recommended = sortedEligible[0] ?? null;

  if (!requestedPeriodId) {
    if (!recommended) return { status: "NO_ELIGIBLE_PERIOD" };
    return { status: "RESOLVED", period: toOption(recommended), eligiblePeriods: eligibleOptions };
  }

  const requested = eligible.find((period) => period.id === requestedPeriodId);
  if (!requested) {
    return {
      status: "INVALID_COMPARISON_PERIOD",
      requestedPeriodId,
      recommended: recommended ? toOption(recommended) : null,
      eligiblePeriods: eligibleOptions,
    };
  }

  return { status: "RESOLVED", period: toOption(requested), eligiblePeriods: eligibleOptions };
}
