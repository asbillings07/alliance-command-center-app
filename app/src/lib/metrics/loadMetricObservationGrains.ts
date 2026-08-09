import type { Prisma } from "@/app/generated/prisma/client";
import { MetricObservationGrain } from "@/app/generated/prisma/enums";

/**
 * Re-fetches authoritative observationGrain for exactly the resolved metric
 * ids, so each MemberMetricEntry can be written with its own metric's actual
 * grain (ADR-018 §3: "written once at insert time from the metric's own
 * grain") - never a hardcoded value, and never trusting a pre-resolution
 * library snapshot.
 *
 * A "create" target only becomes a concrete metric id after
 * resolveMetricTargets runs (which can create/attach metrics mid-transaction),
 * so this must run inside the same transaction, after resolution and before
 * any memberMetricEntry.createMany write - same requirement and same
 * precedent as assertBooleanMetricValuesValid.
 */
export async function loadMetricObservationGrains(
  tx: Prisma.TransactionClient,
  metricIds: readonly string[],
): Promise<Map<string, MetricObservationGrain>> {
  const uniqueIds = [...new Set(metricIds)];
  if (uniqueIds.length === 0) return new Map();

  const metrics = await tx.metric.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, observationGrain: true },
  });
  return new Map(metrics.map((m) => [m.id, m.observationGrain]));
}

/**
 * Looks up a metric's observationGrain from an already-loaded map, throwing
 * if it's missing rather than silently falling back - a missing entry means
 * the caller resolved a metric id that loadMetricObservationGrains was never
 * asked about, which is a programming error, not a legitimate "unknown
 * grain" case (every Metric row has always had this column populated by a
 * default since the Phase 1 migration).
 */
export function requireMetricObservationGrain(
  grainByMetricId: ReadonlyMap<string, MetricObservationGrain>,
  metricId: string,
): MetricObservationGrain {
  const grain = grainByMetricId.get(metricId);
  if (!grain) {
    throw new Error(`Could not resolve observation grain for metric ${metricId}`);
  }
  return grain;
}

/**
 * Rejects any mapping targeting a DAILY_OBSERVATION metric.
 *
 * Import (single- and multi-period) has no per-row date column to collect
 * `observedOn` yet (#287 database design §8), so writing one of these
 * mappings would deterministically fail the grain/observedOn CHECK
 * constraint at the DB layer with a much less useful message. Fail fast here
 * instead, before any memberMetricEntry.createMany write - remove this guard
 * once a later slice adds daily-observation import support.
 */
export function assertNoDailyObservationMetrics(
  grainByMetricId: ReadonlyMap<string, MetricObservationGrain>,
  metricIds: readonly string[],
): void {
  for (const metricId of new Set(metricIds)) {
    if (requireMetricObservationGrain(grainByMetricId, metricId) === MetricObservationGrain.DAILY_OBSERVATION) {
      throw new Error(
        "One or more mapped metrics record daily observations and cannot be imported yet - this importer has no way to collect the observation date",
      );
    }
  }
}
