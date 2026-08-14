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
 * Best-effort human-readable label for a single comparison period.
 * `MetricPeriod` has no uniqueness constraint on `name` (see
 * `schema.prisma`), so the bare name alone can't be trusted to identify a
 * specific period - e.g. two periods named "Week 18" would otherwise be
 * indistinguishable in the UI.
 *
 * `startsAt`/`endsAt` are independently nullable, so this uses whichever of
 * the two is actually set rather than requiring both, falling back to
 * `createdAt` when neither is set (mirroring `compareMetricPeriodsForCurrent`'s
 * own tie-break chain). Reuses this codebase's existing `toLocaleDateString()`
 * convention (see `periods/[periodId]/page.tsx`, `metricPeriodCard.tsx`)
 * rather than introducing a new date formatter.
 *
 * **Not guaranteed unique in isolation** - `toLocaleDateString()` collapses
 * `createdAt` to day precision, so two same-named periods created the same
 * day, or two same-named periods with identical `startsAt`/`endsAt`, still
 * produce identical output from this function alone. None of `name`,
 * `startsAt`, `endsAt`, or day-precision `createdAt` are actually unique -
 * only `id` is. Callers that need a *guaranteed* distinguishable label
 * across a set of periods (the compare dropdown's options, and the trend
 * pill naming whichever period was chosen from that same set) must use
 * `formatComparePeriodLabels` below instead.
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

/**
 * Guaranteed-distinguishable labels for a set of periods, keyed by `id`.
 * Runs `formatComparePeriodLabel` on every period, then appends the
 * period's **full** `id` - the one field actually guaranteed unique - only
 * to the entries that still collide after that. The common case (every
 * period already reads differently) never shows an id at all; a genuine
 * collision (identical name, identical date range, or identical creation
 * day) still can never produce two indistinguishable options, because two
 * distinct periods can never share an id.
 *
 * Deliberately the *full* id, not a truncated fragment: two distinct ids
 * can share any fixed-length suffix (or prefix), so truncating would only
 * shrink the odds of a residual collision, not eliminate them - which
 * would silently break the one guarantee this function exists to make.
 *
 * Callers (the compare dropdown, and the trend pill looking up whichever
 * period was chosen) should call this once per render over the same
 * `eligiblePeriods` list, rather than calling `formatComparePeriodLabel`
 * directly, whenever the result is shown to a leader who needs to tell
 * periods apart.
 */
export function formatComparePeriodLabels(
  periods: readonly ComparePeriodHeader[],
): Map<string, string> {
  const baseLabelsById = new Map(periods.map((period) => [period.id, formatComparePeriodLabel(period)] as const));

  const occurrences = new Map<string, number>();
  for (const label of baseLabelsById.values()) {
    occurrences.set(label, (occurrences.get(label) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const period of periods) {
    const baseLabel = baseLabelsById.get(period.id)!;
    const isColliding = (occurrences.get(baseLabel) ?? 0) > 1;
    result.set(period.id, isColliding ? `${baseLabel} \u00b7 ${period.id}` : baseLabel);
  }
  return result;
}
