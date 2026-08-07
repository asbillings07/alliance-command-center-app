/**
 * Pure period-comparability and configuration-stability math for the APS
 * data-readiness audit (#284 PR A). Prisma-free by design; `apsDataReadinessAudit.ts`
 * supplies plain rows already scoped to one alliance and one read-only
 * transaction.
 *
 * "Comparable" here deliberately mirrors the same rule
 * `resolveComparablePeriod.ts` already uses for report period-over-period
 * comparisons (both periods dated, candidate strictly precedes selected,
 * identical duration) — the audit is measuring how much of that existing
 * primitive the alliance's real period history can actually use, not
 * inventing a second comparability rule.
 */

export type AuditPeriodCandidate = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

/**
 * Coarse duration buckets, never the exact period length. #284's evidence
 * requirements ask for both the *count* and the *duration* of comparable
 * periods (does an alliance evaluate roughly weekly, biweekly, monthly, or
 * something irregular?) -- bucketing answers that without disclosing an
 * exact, potentially identifying period length for a small sample.
 */
export type PeriodDurationBucket = "LTE_7_DAYS" | "D8_TO_14_DAYS" | "D15_TO_31_DAYS" | "D32_PLUS_DAYS";

export const PERIOD_DURATION_BUCKETS: readonly PeriodDurationBucket[] = [
  "LTE_7_DAYS",
  "D8_TO_14_DAYS",
  "D15_TO_31_DAYS",
  "D32_PLUS_DAYS",
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function bucketForDurationDays(days: number): PeriodDurationBucket {
  if (days <= 7) return "LTE_7_DAYS";
  if (days <= 14) return "D8_TO_14_DAYS";
  if (days <= 31) return "D15_TO_31_DAYS";
  return "D32_PLUS_DAYS";
}

export type ComparablePeriodStats = {
  periodCount: number;
  periodsWithBothDatesCount: number;
  /** Pairs of dated periods with identical duration where one strictly precedes the other (same rule as resolveComparablePeriod.ts). */
  comparablePairCount: number;
  /** One count per dated period (not per pair), bucketed by (endsAt - startsAt). */
  durationBucketCounts: Record<PeriodDurationBucket, number>;
};

function isDated(period: AuditPeriodCandidate): period is AuditPeriodCandidate & { startsAt: Date; endsAt: Date } {
  return period.startsAt !== null && period.endsAt !== null;
}

function strictlyPrecedesWithEqualDuration(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  const aDuration = a.endsAt.getTime() - a.startsAt.getTime();
  const bDuration = b.endsAt.getTime() - b.startsAt.getTime();
  if (aDuration !== bDuration) return false;
  return a.endsAt.getTime() < b.startsAt.getTime() || b.endsAt.getTime() < a.startsAt.getTime();
}

export function computeComparablePeriodStats(periods: readonly AuditPeriodCandidate[]): ComparablePeriodStats {
  const dated = periods.filter(isDated);
  let comparablePairCount = 0;
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      if (strictlyPrecedesWithEqualDuration(dated[i]!, dated[j]!)) {
        comparablePairCount += 1;
      }
    }
  }

  const durationBucketCounts = Object.fromEntries(PERIOD_DURATION_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    PeriodDurationBucket,
    number
  >;
  for (const period of dated) {
    const days = (period.endsAt.getTime() - period.startsAt.getTime()) / MS_PER_DAY;
    durationBucketCounts[bucketForDurationDays(days)] += 1;
  }

  return {
    periodCount: periods.length,
    periodsWithBothDatesCount: dated.length,
    comparablePairCount,
    durationBucketCounts,
  };
}

export type AuditPeriodAttachmentSnapshot = {
  periodId: string;
  startsAt: Date;
  endsAt: Date;
  /** metricId -> weight, for this period's active attachments only. */
  activeComponents: Map<string, number>;
};

export type MetricStabilityStats = {
  /** Chronologically consecutive, dated-period pairs this alliance has (the only pairs a change can be measured across). */
  consecutivePeriodPairCount: number;
  metricsAddedCount: number;
  metricsRemovedCount: number;
  weightChangedCount: number;
};

/**
 * Compares each chronologically consecutive pair of dated periods' active
 * attachment sets. Only periods with both `startsAt` and `endsAt` participate
 * — matching the same "dated periods only" precondition `computeComparablePeriodStats`
 * uses, so a period with no dates can't silently count as "the period before/after"
 * another.
 */
export function computeMetricStabilityStats(
  periods: readonly AuditPeriodAttachmentSnapshot[],
): MetricStabilityStats {
  const sorted = [...periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let metricsAddedCount = 0;
  let metricsRemovedCount = 0;
  let weightChangedCount = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;

    for (const metricId of curr.activeComponents.keys()) {
      if (!prev.activeComponents.has(metricId)) metricsAddedCount += 1;
    }
    for (const metricId of prev.activeComponents.keys()) {
      if (!curr.activeComponents.has(metricId)) metricsRemovedCount += 1;
    }
    for (const [metricId, prevWeight] of prev.activeComponents) {
      const currWeight = curr.activeComponents.get(metricId);
      if (currWeight !== undefined && currWeight !== prevWeight) {
        weightChangedCount += 1;
      }
    }
  }

  return {
    consecutivePeriodPairCount: Math.max(sorted.length - 1, 0),
    metricsAddedCount,
    metricsRemovedCount,
    weightChangedCount,
  };
}
