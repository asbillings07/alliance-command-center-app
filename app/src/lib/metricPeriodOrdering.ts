import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Order evaluation periods for "current" resolution: latest startsAt first,
 * null startsAt last, then createdAt and id as tiebreakers.
 */
export const metricPeriodChronologicalOrderBy = [
  { startsAt: { sort: "desc" as const, nulls: "last" as const } },
  { createdAt: "desc" as const },
  { id: "desc" as const },
] satisfies Prisma.MetricPeriodOrderByWithRelationInput[];

export type MetricPeriodOrderingFields = {
  id: string;
  startsAt: Date | null;
  createdAt: Date;
};

export function compareMetricPeriodsForCurrent(
  a: MetricPeriodOrderingFields,
  b: MetricPeriodOrderingFields,
): number {
  const aStart = a.startsAt?.getTime() ?? null;
  const bStart = b.startsAt?.getTime() ?? null;

  if (aStart !== null && bStart !== null) {
    if (aStart !== bStart) {
      return bStart - aStart;
    }
  } else if (aStart !== null) {
    return -1;
  } else if (bStart !== null) {
    return 1;
  }

  const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return b.id.localeCompare(a.id);
}

export function pickCurrentMetricPeriod<T extends MetricPeriodOrderingFields>(
  periods: T[],
): T | null {
  if (periods.length === 0) {
    return null;
  }
  return [...periods].sort(compareMetricPeriodsForCurrent)[0] ?? null;
}
