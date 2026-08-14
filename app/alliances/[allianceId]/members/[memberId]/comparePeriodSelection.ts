/**
 * Explicit "Compare with" period selection for member detail (#349),
 * replacing the implicit "always compare against the chronologically
 * adjacent period" model #321-#325 shipped. Deliberately Prisma-free and
 * side-effect-free so the resolution rules can be unit-tested on plain
 * objects - `page.tsx` supplies `eligiblePeriods` (already scoped to the
 * alliance and filtered to periods strictly older than the selected one via
 * `findOlderMetricPeriods`) and is responsible for turning the result into
 * `notFound()`/`redirect()` calls.
 *
 * Four outcomes, not two, so two states that must never be conflated stay
 * distinct all the way to the UI:
 *   - `explicit-none`: the leader deliberately opted out of a comparison
 *     that *was* available - the trend badge should be suppressed entirely.
 *   - `no-prior-period`: there is nothing older to compare against at all
 *     (the alliance's first-ever period) - the existing, truthful `New`
 *     badge should still render, exactly as it does today.
 * Both round-trip through their own URL sentinel (`none` / `no-prior`)
 * rather than sharing one, so a canonicalized URL always unambiguously
 * reconstructs which of the two applied.
 */

export type ComparePeriodHeader = {
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
};

export type ComparePeriodSelection =
  | { status: "invalid" }
  | { status: "explicit-none"; isCanonical: true }
  | { status: "no-prior-period"; isCanonical: boolean }
  | { status: "period"; comparePeriod: ComparePeriodHeader; isCanonical: boolean };

export const NO_COMPARISON_PARAM = "none";
export const NO_PRIOR_PERIOD_PARAM = "no-prior";

/**
 * Resolve the effective comparison period given an optional caller-requested
 * id and the set of periods eligible to be compared against (already
 * filtered to "strictly older than the selected period," nearest-first).
 *
 * `isCanonical: false` means the caller should redirect to make this
 * resolution explicit in the URL - it is only ever false when
 * `requestedComparePeriodId` was `undefined` (omitted entirely). Every
 * explicit request is either accepted as-is (`isCanonical: true`) or
 * rejected outright (`invalid`) - never silently substituted, so a rejected
 * request can never be confused with "the caller didn't ask for anything."
 */
export function resolveComparePeriodSelection(params: {
  requestedComparePeriodId: string | undefined;
  eligiblePeriods: readonly ComparePeriodHeader[];
}): ComparePeriodSelection {
  const { requestedComparePeriodId, eligiblePeriods } = params;

  if (requestedComparePeriodId === undefined) {
    if (eligiblePeriods.length === 0) {
      return { status: "no-prior-period", isCanonical: false };
    }
    return { status: "period", comparePeriod: eligiblePeriods[0]!, isCanonical: false };
  }

  if (requestedComparePeriodId === NO_PRIOR_PERIOD_PARAM) {
    // The sentinel must match reality: it's only meaningful when there truly
    // is nothing older to compare against.
    return eligiblePeriods.length === 0
      ? { status: "no-prior-period", isCanonical: true }
      : { status: "invalid" };
  }

  if (requestedComparePeriodId === NO_COMPARISON_PARAM) {
    // There's nothing to explicitly decline when nothing was ever offered -
    // that's `no-prior-period`'s territory, not this one's.
    return eligiblePeriods.length === 0
      ? { status: "invalid" }
      : { status: "explicit-none", isCanonical: true };
  }

  const match = eligiblePeriods.find((period) => period.id === requestedComparePeriodId);
  return match ? { status: "period", comparePeriod: match, isCanonical: true } : { status: "invalid" };
}

/**
 * Disambiguated label for a comparison period, used by both the "Compare
 * with" dropdown's options and the trend pill's visible text. `MetricPeriod`
 * has no uniqueness constraint on `name` (see `schema.prisma`), so the bare
 * name alone can't be trusted to identify a specific period - e.g. two
 * periods named "Week 18" would otherwise be indistinguishable in the UI.
 *
 * `startsAt`/`endsAt` are independently nullable, so this uses whichever of
 * the two is actually set rather than requiring both. When *neither* is
 * set, falls back to `createdAt` - unlike the date fields, every period has
 * one, so two same-named undated periods still get distinguishable labels
 * (this mirrors `compareMetricPeriodsForCurrent`'s own tie-break chain:
 * `startsAt`, then `createdAt`). Reuses this codebase's existing
 * `toLocaleDateString()` convention (see `periods/[periodId]/page.tsx`,
 * `metricPeriodCard.tsx`) rather than introducing a new date formatter.
 */
export function formatComparePeriodLabel(period: ComparePeriodHeader): string {
  const { name, startsAt, endsAt, createdAt } = period;

  if (startsAt && endsAt) {
    return `${name} (${startsAt.toLocaleDateString()} \u2013 ${endsAt.toLocaleDateString()})`;
  }
  if (startsAt) {
    return `${name} (from ${startsAt.toLocaleDateString()})`;
  }
  if (endsAt) {
    return `${name} (through ${endsAt.toLocaleDateString()})`;
  }
  return `${name} (created ${createdAt.toLocaleDateString()})`;
}
