import { MetricTrendDirection } from "@/app/generated/prisma/enums";
import { isAdverseComparisonChange } from "@/app/src/lib/metrics/metricTrendDirection";
import type { CurrentMetricViewModel, PeriodTrendViewModel, TrendFavorability } from "./MemberPerformanceSection";

/**
 * The two things this view model needs from each `MemberMetricEntry` row.
 * Deliberately does NOT include `status` - see the "why not `status`"
 * paragraph below.
 */
export type RawMemberMetricEntry = {
  metricId: string;
  value: number | null;
  recordedAt: Date;
  createdAt: Date;
  id: string;
};

export type PeriodMetricInput = {
  metricId: string;
  metricName: string;
  /**
   * Only consumed by `buildPeriodTrendViewModels` below (for the trend
   * badge's favorable/adverse coloring) - `buildCurrentMetricViewModels`
   * ignores it entirely. Carried on the shared input type rather than a
   * second parallel array because every caller already has one
   * `Metric`-joined row per period metric to build this from.
   */
  trendDirection: MetricTrendDirection;
};

/**
 * `MemberPage`'s "current vs. previous entry" cards are a raw
 * `MemberMetricEntry` history view, NOT a canonical-rollup view - deliberately
 * kept off `memberPeriodMetricValues` (ADR-018 Sec6, the one-row-per-metric
 * summary read model #287 Slices 2-3 migrated other reports onto). That
 * model discards history by design (it exists to answer "what's the
 * authoritative value," not "what changed"), while this page exists to
 * answer the opposite question for one member: "what were their last two
 * recorded values, and by how much did the most recent one move." Those are
 * different data-model contracts, not one contract two consumers happen to
 * read differently - see the parity log's "Remaining consumers" note for
 * #287 Slice 3.
 *
 * "Current"/"previous" here means "the two most recent `MemberMetricEntry`
 * rows for this metric," full stop - NOT "current period vs. previous
 * period" (there is no period comparison anywhere on this page; both rows
 * are scoped to the one selected period). Consider this before renaming or
 * relocating this concept.
 *
 * Rows are chosen **positionally** by the deterministic
 * `(recordedAt, createdAt, id)` tie-break order (matching every writer's own
 * insert-order precedence, ADR-018 Sec4) - a value-blind pick, not a "keep
 * scanning until you find two real values" pick. This is the fix for a real
 * bug the positional-blind version doesn't have: skipping past a `VOIDED`
 * row's null value *before* picking two entries would let an older,
 * superseded `ACTIVE` value silently stand in for "current" when the
 * member's most recent event for that metric was actually a void of it.
 * Positional selection instead shows "not recorded" for a voided-latest slot
 * - not a wrong number - accepting that it can't yet show the leader an
 * explicit "this was voided" state (that's real UI/product scope for
 * whichever future slice designs the void/correction mutation surface, not
 * a read-model wiring change).
 *
 * `status` is deliberately not read: a `VOIDED` row is fully identified by
 * `value === null` alone (the Sec3b status/value CHECK constraint makes
 * every `VOIDED` row's value null and every `ACTIVE` row's value non-null
 * for `PERIOD_VALUE` grain, which this page's single-value-per-entry
 * "current/previous" model only makes sense for anyway), so reading it
 * would be redundant, not additional signal.
 *
 * Issue #319 asked for an explicit product decision locking in this
 * "current/previous" definition (as opposed to a period-over-period trend -
 * see that issue's decision-lock comment for the full rationale). The
 * decision: keep this behavior exactly as implemented here. A true
 * "this period's value vs. last period's value" trend was deliberately
 * scoped out as a separate future feature, not a redefinition of this
 * function.
 */
export function buildCurrentMetricViewModels(
  periodMetrics: readonly PeriodMetricInput[],
  entries: readonly RawMemberMetricEntry[],
): CurrentMetricViewModel[] {
  const entriesByMetric = new Map<string, RawMemberMetricEntry[]>();
  for (const entry of entries) {
    const bucket = entriesByMetric.get(entry.metricId);
    if (bucket) bucket.push(entry);
    else entriesByMetric.set(entry.metricId, [entry]);
  }
  // Sort each metric's own bucket explicitly, rather than trusting the
  // caller's query order - this function's own contract (a value-blind
  // positional pick) is only correct if "position 0" reliably means "the
  // most recent entry," ties included.
  for (const bucket of entriesByMetric.values()) {
    bucket.sort((a, b) => {
      if (a.recordedAt.getTime() !== b.recordedAt.getTime()) {
        return b.recordedAt.getTime() - a.recordedAt.getTime();
      }
      if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
  }

  return periodMetrics.map((pm) => {
    const [mostRecent, secondMostRecent] = entriesByMetric.get(pm.metricId) ?? [];
    const current = mostRecent?.value != null ? { value: mostRecent.value, recordedAt: mostRecent.recordedAt } : undefined;
    const previous =
      secondMostRecent?.value != null
        ? { value: secondMostRecent.value, recordedAt: secondMostRecent.recordedAt }
        : undefined;

    return {
      metricId: pm.metricId,
      metricName: pm.metricName,
      current,
      previous,
      delta: current && previous ? current.value - previous.value : undefined,
    };
  });
}

/** One metric's derived value for a single period - deliberately the same
 * minimal shape whether it came from the selected period or the prior one,
 * since `buildPeriodTrendViewModels` treats both symmetrically. */
export type RollupMetricValue = { metricId: string; value: number | null };

/**
 * A `comparable` trend's numeric `direction` ("up"/"down"/"flat") is a
 * plain fact about the two values, computed once in #322 and never
 * reinterpreted here. Whether that fact is good or bad news is a *separate*
 * leadership judgment the metric's own `trendDirection` config already
 * encodes (`metricTrendDirection.ts`, #264 PR2 - the same enum
 * `allianceFindings.ts`'s deterministic findings engine already uses for
 * "is this period-over-period change adverse"). Reusing
 * `isAdverseComparisonChange` here, rather than a naive "up is always
 * green," is what makes a `LOWER_IS_BETTER` metric (e.g. an infraction
 * count) trending up correctly render as adverse (red), not favorable
 * (green) - a naive direction-only color would be actively misleading for
 * exactly the metrics where a leader cares most.
 */
function classifyTrendFavorability(
  trendDirection: MetricTrendDirection,
  delta: number,
): TrendFavorability {
  if (delta === 0 || trendDirection === MetricTrendDirection.NEUTRAL) {
    return "neutral";
  }
  return isAdverseComparisonChange(trendDirection, delta) ? "adverse" : "favorable";
}

/**
 * #321/#322's period-over-period trend - a deliberately separate concept
 * from `buildCurrentMetricViewModels` above, not a replacement or extension
 * of it. Sources both periods' values from the canonical
 * `memberPeriodMetricValues` read model (ADR-018 Sec6), not from the raw
 * `MemberMetricEntry` history that function reads - see #321's scope
 * comment for why mixing those two sources for one card's arithmetic would
 * be a subtle correctness trap, and why it's fine to source `current`'s
 * *display* value from the correction view while this function computes
 * its own trend arithmetic entirely from rollup values.
 *
 * `priorPeriodValues === null` means "no prior period exists in the
 * alliance's history at all" (this is the earliest period), which is a
 * period-level fact applying uniformly to every metric - not "the prior
 * period has no data for any metric," which would still be a per-metric
 * `no-baseline`. Callers resolve `null` via
 * `findPriorMetricPeriod` (`metricPeriodOrdering.ts`) returning `null`.
 *
 * Callers are responsible for not attaching a `PeriodTrendViewModel` onto a
 * metric whose `buildCurrentMetricViewModels` `current` is itself
 * `undefined` (e.g. the latest event this period was a void) - this
 * function has no visibility into that raw-entry state and would otherwise
 * report a stale `comparable`/`no-baseline` trend for a metric the page is
 * simultaneously showing as "Not recorded."
 */
export function buildPeriodTrendViewModels(
  periodMetrics: readonly PeriodMetricInput[],
  currentPeriodValues: readonly RollupMetricValue[],
  priorPeriodValues: readonly RollupMetricValue[] | null,
): Map<string, PeriodTrendViewModel> {
  if (priorPeriodValues === null) {
    const newEntries: [string, PeriodTrendViewModel][] = periodMetrics.map((pm) => [
      pm.metricId,
      { status: "new" },
    ]);
    return new Map(newEntries);
  }

  const currentByMetric = new Map(currentPeriodValues.map((v) => [v.metricId, v.value]));
  const priorByMetric = new Map(priorPeriodValues.map((v) => [v.metricId, v.value]));

  const entries: [string, PeriodTrendViewModel][] = periodMetrics.map((pm) => {
    const currentValue = currentByMetric.get(pm.metricId) ?? null;
    const previousValue = priorByMetric.get(pm.metricId) ?? null;

    if (currentValue === null || previousValue === null) {
      return [pm.metricId, { status: "no-baseline" }];
    }

    const delta = currentValue - previousValue;
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const favorability = classifyTrendFavorability(pm.trendDirection, delta);

    return [pm.metricId, { status: "comparable", currentValue, previousValue, delta, direction, favorability }];
  });

  return new Map(entries);
}
