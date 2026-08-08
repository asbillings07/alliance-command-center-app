import type { Prisma } from "@/app/generated/prisma/client";
import type { MetricObservationGrain } from "@/app/generated/prisma/enums";

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
