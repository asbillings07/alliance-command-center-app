import type { Prisma } from "@/app/generated/prisma/client";
import { Metric_Type } from "@/app/generated/prisma/enums";
import { isValidBooleanMetricValue } from "./booleanMetricValue";

export type MetricValueEntry = { value: number };
export type MetricValueMapping = { metricId: string; entries: readonly MetricValueEntry[] };

/**
 * Re-fetches authoritative metric types for exactly the resolved metric ids
 * and rejects any entry mapped to a BOOLEAN metric whose value isn't exactly
 * 0 or 1 (#190).
 *
 * Never trust a pre-resolution library snapshot for `type` — a "create"
 * target only becomes a concrete metric id after `resolveMetricTargets` runs
 * (which can create/attach metrics mid-transaction), so this must run inside
 * the same transaction, after resolution and before any
 * `memberMetricEntry.createMany` write. A violation throws, rolling back the
 * whole transaction — this only guards new writes; legacy rows written before
 * this check existed are handled by the report read-model's `INVALID` status
 * instead of being rejected retroactively.
 */
export async function assertBooleanMetricValuesValid(
  tx: Prisma.TransactionClient,
  mappings: readonly MetricValueMapping[],
): Promise<void> {
  const metricIds = [...new Set(mappings.map((m) => m.metricId))];
  if (metricIds.length === 0) return;

  const metrics = await tx.metric.findMany({
    where: { id: { in: metricIds } },
    select: { id: true, type: true },
  });
  const typeById = new Map(metrics.map((m) => [m.id, m.type]));

  for (const mapping of mappings) {
    if (typeById.get(mapping.metricId) !== Metric_Type.BOOLEAN) continue;
    for (const entry of mapping.entries) {
      if (!isValidBooleanMetricValue(entry.value)) {
        throw new Error("Boolean metric values must be exactly 0 or 1");
      }
    }
  }
}
