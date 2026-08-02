/**
 * MetricTrendDirection (#264 PR2) — whether a period-over-period change is
 * worth surfacing as "needs attention." Deliberately independent of
 * `Metric_Type`/`MetricSummaryKind`: every direction is a valid choice for
 * every type/summaryKind pairing (there is no DB CHECK constraint here,
 * unlike `metricSummaryKind.ts`), because directionality is a leadership
 * judgment about what the metric *means*, not something derivable from its
 * shape. It's also meaningful independent of `summaryKind`: a metric
 * reconfigured from NONE to SUM later keeps whatever direction was already
 * set, rather than losing it.
 *
 * `NEUTRAL` is the safe default — the deterministic findings engine
 * (`allianceFindings.ts`) never generates an adverse-comparison finding for
 * a NEUTRAL metric, regardless of which way its number moves.
 */
import { MetricTrendDirection } from "@/app/generated/prisma/enums";

export const METRIC_TREND_DIRECTION_LABELS: Record<MetricTrendDirection, string> = {
  [MetricTrendDirection.NEUTRAL]: "Neutral (no adverse-change findings)",
  [MetricTrendDirection.HIGHER_IS_BETTER]: "Higher is better",
  [MetricTrendDirection.LOWER_IS_BETTER]: "Lower is better",
};

/**
 * Whether a period-over-period change counts as "adverse" for the
 * findings engine — the only place this enum's meaning is actually acted
 * on. `NEUTRAL` is never adverse, and a change of exactly zero is
 * "unchanged," never adverse, regardless of direction.
 */
export function isAdverseComparisonChange(
  direction: MetricTrendDirection,
  absoluteChange: number,
): boolean {
  switch (direction) {
    case MetricTrendDirection.HIGHER_IS_BETTER:
      return absoluteChange < 0;
    case MetricTrendDirection.LOWER_IS_BETTER:
      return absoluteChange > 0;
    case MetricTrendDirection.NEUTRAL:
    default:
      return false;
  }
}
