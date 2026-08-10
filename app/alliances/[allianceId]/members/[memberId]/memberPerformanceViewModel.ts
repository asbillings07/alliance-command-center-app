import type { CurrentMetricViewModel } from "./MemberPerformanceSection";

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

export type PeriodMetricInput = { metricId: string; metricName: string };

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
