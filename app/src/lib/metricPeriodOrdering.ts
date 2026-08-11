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
  periods: readonly T[],
): T | null {
  if (periods.length === 0) {
    return null;
  }
  return [...periods].sort(compareMetricPeriodsForCurrent)[0] ?? null;
}

/**
 * The period immediately preceding `selectedPeriodId` in the same
 * chronological total order `pickCurrentMetricPeriod` uses - i.e. "one
 * position older," not "the last period with any data." Used by the
 * member-detail page's period-over-period trend (#321/#322): a genuinely
 * adjacent-period comparison, never ad hoc date math.
 *
 * Returns `null` for two distinct reasons a caller must not conflate:
 * `selectedPeriodId` is the oldest period in `periods` (there is no prior
 * period - the alliance's first-ever period), or `selectedPeriodId` isn't
 * present in `periods` at all (a defensive case; callers are expected to
 * pass the same period list a selected period was drawn from).
 */
export function findPriorMetricPeriod<T extends MetricPeriodOrderingFields>(
  periods: readonly T[],
  selectedPeriodId: string,
): T | null {
  const sorted = [...periods].sort(compareMetricPeriodsForCurrent);
  const selectedIndex = sorted.findIndex((p) => p.id === selectedPeriodId);
  if (selectedIndex === -1) {
    return null;
  }
  return sorted[selectedIndex + 1] ?? null;
}
