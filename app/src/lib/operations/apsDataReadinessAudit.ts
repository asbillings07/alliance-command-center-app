/**
 * APS data-readiness audit (#284 PR A).
 *
 * Read-only, aggregate-only evidence for the Alliance Performance Score
 * discovery ADR (#284). This module never sees the global `prisma` client —
 * every query takes the caller's `AuditTxClient`, which `runInReadOnlyAuditTransaction`
 * (see `apsAuditTransaction.ts`) has already put into a database-enforced
 * `SET TRANSACTION READ ONLY` transaction before this module's first query
 * runs.
 *
 * Output is pseudonymous (alliance and metric labels only — see
 * `apsAuditPrivacy.ts`) and small-cell-suppressed. No player names, no raw
 * per-member rows, no auth data, and no alliance-chosen metric names ever
 * leave this module. Callers (the CLI script) are responsible for treating
 * the *input* allowlist itself as sensitive too — never log it verbatim
 * alongside the report.
 *
 * Coverage and distribution stats are computed DB-side (a single
 * `DISTINCT ON` + aggregate query per alliance, mirroring
 * `getAlliancePerformanceReport.ts`'s `queryBulkAggregates`), not by
 * pulling every historical row into JS and deduplicating in memory — this
 * keeps the audit's per-alliance cost bounded by (metrics x members), not
 * by the alliance's total entry history.
 *
 * This module answers the "production-derived aggregates" third of the
 * three-part evidence package described in ADR-017; it deliberately does
 * NOT answer leader-intent (targets/weights leaders already use) or
 * synthetic edge cases — see `docs/adr/017-aps-evidence.md` for those.
 */
import { Prisma } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { pickCurrentMetricPeriod } from "@/app/src/lib/metricPeriodOrdering";
import type { AuditTxClient } from "./apsAuditTransaction";
import { validateAllianceAllowlist } from "./apsAuditAllowlist";
import {
  MIN_CELL_SIZE,
  assignPseudonymousAllianceLabels,
  assignPseudonymousMetricLabels,
  suppressCorrelatedCounts,
  type SuppressibleStatistic,
} from "./apsAuditPrivacy";
import {
  computeComparablePeriodStats,
  computeMetricStabilityStats,
  type AuditPeriodAttachmentSnapshot,
  type ComparablePeriodStats,
  type MetricStabilityStats,
} from "./apsAuditPeriodAnalysis";

/**
 * A metric needs at least one member's *valid* recorded value in at least
 * this many distinct periods to be considered dogfood-ready -- not merely
 * attached to that many periods with nothing ever entered. "Enough
 * repeated observations to look at at all," not a scoring decision.
 */
export const MIN_PERIODS_FOR_DOGFOOD = 3;

export type MetricConfigurationStats = {
  totalMetricCount: number;
  activeMetricCount: number;
  archivedMetricCount: number;
  byType: Record<Metric_Type, number>;
  bySummaryKind: Record<MetricSummaryKind, number>;
  byTrendDirection: Record<MetricTrendDirection, number>;
  /** Across every period, not just the current one. */
  activeAttachmentCount: number;
  inactiveAttachmentCount: number;
};

export type CurrentPeriodWeightStats =
  | { currentPeriodFound: false }
  | {
      currentPeriodFound: true;
      activeComponentCount: number;
      zeroWeightComponentCount: number;
      requiredComponentCount: number;
      weightSum: number;
    };

/** Active-member coverage for one metric in one period. */
export type MetricCoverageStats = {
  currentActiveMemberCount: number;
  recordedActiveMemberCount: number;
  invalidActiveMemberCount: number;
  missingActiveMemberCount: number;
};

export type NumericDistribution = {
  count: number;
  min: number;
  max: number;
  /** Linear-interpolation percentiles, matching PostgreSQL's `percentile_cont`. */
  p25: number;
  p50: number;
  p75: number;
  zeroCount: number;
  negativeCount: number;
  /** Values outside [p25 - 1.5*IQR, p75 + 1.5*IQR] -- the standard Tukey fence, not a leadership judgment. */
  outlierCount: number;
};

/** `distribution` is `null` when there are genuinely zero valid values -- an honest "no data" state, distinct from suppression (see `MetricDistributionRow.stats`). */
export type NumericMetricDistributionSection = {
  kind: "NUMERIC";
  distribution: NumericDistribution | null;
};

export type BooleanMetricDistributionSection = {
  kind: "BOOLEAN";
  counts: { trueCount: number; falseCount: number };
};

/**
 * Every count for one metric in one period is bundled and suppressed
 * TOGETHER (`MetricDistributionRow.stats`), never field-by-field: coverage,
 * archived contributors, and the section's total valid count are linked by
 * an exact relationship (e.g. `totalValid = recordedActiveMemberCount +
 * archivedContributingMemberCount`), so independently suppressing just one
 * of them while showing the other two would let the hidden one be
 * recovered by subtraction. See `suppressCorrelatedCounts` in
 * `apsAuditPrivacy.ts`.
 */
export type MetricRowStats = {
  coverage: MetricCoverageStats;
  /** Archived (former) members whose latest value still counts in the rollup. */
  archivedContributingMemberCount: number;
  section: NumericMetricDistributionSection | BooleanMetricDistributionSection;
};

export type MetricDistributionRow = {
  metricLabel: string;
  summaryKind: MetricSummaryKind;
  trendDirection: MetricTrendDirection;
  stats: SuppressibleStatistic<MetricRowStats>;
};

export type DogfoodReadinessStats = {
  totalMetricCount: number;
  metricsWithEnoughObservationsCount: number;
  minPeriodsForDogfood: number;
};

export type AllianceAuditSection = {
  label: string;
  comparablePeriods: ComparablePeriodStats;
  metricConfiguration: MetricConfigurationStats;
  currentPeriodWeights: CurrentPeriodWeightStats;
  metricDistributions: MetricDistributionRow[];
  metricStability: MetricStabilityStats;
  dogfoodReadiness: DogfoodReadinessStats;
};

export type ApsDataReadinessAuditReport = {
  generatedAt: string;
  allianceCount: number;
  minCellSize: number;
  minPeriodsForDogfood: number;
  alliances: AllianceAuditSection[];
  limitations: string[];
};

const LIMITATIONS = [
  "This is a bounded, consented Founder Beta sample — not a statistically representative sample of all ACC alliances.",
  "Aggregate statistics below a small-cell threshold are suppressed rather than shown exactly (see minCellSize).",
  "Custom, leader-chosen metric names are never included — metrics are labeled generically (Metric 1, Metric 2, ...) per alliance.",
  "Leader-intent evidence (targets/weights leaders already use outside ACC) is not produced by this audit; see the evidence report's separate leader-intent section.",
  "Distribution statistics (min/max/quantiles/outliers) include both active and archived members' latest valid values for the period, matching the same rollup population Reports already uses for SUM/AVERAGE — coverage counts remain active-member-scoped.",
  "Period durations are reported as coarse buckets, never exact lengths.",
  "The printed report also coarsens small (1-4) alliance-configuration counts (periods, metric types/attachments, weight components, stability changes, dogfood readiness) to reduce sparse-configuration re-identification risk. This is a coarsening for casual reading, not a guarantee against reconstruction by cross-referencing other exact fields in the same report.",
];

// ---------------------------------------------------------------------------
// Per-alliance data loading
// ---------------------------------------------------------------------------

type MetricWithAttachments = {
  id: string;
  type: Metric_Type;
  summaryKind: MetricSummaryKind;
  trendDirection: MetricTrendDirection;
  active: boolean;
  periodMetrics: { periodId: string; weight: number; required: boolean; active: boolean }[];
};

async function loadAllianceMetrics(tx: AuditTxClient, allianceId: string): Promise<MetricWithAttachments[]> {
  return tx.metric.findMany({
    where: { allianceId },
    select: {
      id: true,
      type: true,
      summaryKind: true,
      trendDirection: true,
      active: true,
      // `Metric` is alliance-scoped, but `MetricPeriodMetric` has independent
      // FKs to `Metric` and `MetricPeriod` with no composite constraint
      // tying them to the SAME alliance -- nothing stops an inconsistent
      // attachment from pairing this alliance's metric with a foreign
      // alliance's period. Filtering on `period.allianceId` here (rather
      // than after loading) keeps every downstream count -- attachment
      // counts, stability, dogfood -- scoped to this alliance's own periods
      // regardless of what a foreign/buggy attachment might otherwise add.
      periodMetrics: {
        where: { period: { allianceId } },
        select: { periodId: true, weight: true, required: true, active: true },
      },
    },
  });
}

type PeriodRow = { id: string; startsAt: Date | null; endsAt: Date | null; createdAt: Date; active: boolean };

async function loadAlliancePeriods(tx: AuditTxClient, allianceId: string): Promise<PeriodRow[]> {
  return tx.metricPeriod.findMany({
    where: { allianceId },
    select: { id: true, startsAt: true, endsAt: true, createdAt: true, active: true },
  });
}

// ---------------------------------------------------------------------------
// DB-side coverage + distribution query (one query per alliance's current
// period, computed entirely in PostgreSQL -- see module doc comment).
// ---------------------------------------------------------------------------

type CoverageDistributionRawRow = {
  metric_id: string;
  current_active_member_count: bigint;
  recorded_active_member_count: bigint;
  invalid_active_member_count: bigint;
  missing_active_member_count: bigint;
  archived_contributing_member_count: bigint;
  true_count: bigint;
  false_count: bigint;
  numeric_valid_count: bigint;
  min_value: number | null;
  max_value: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  zero_count: bigint;
  negative_count: bigint;
  outlier_count: bigint;
};

type CoverageDistributionAggregate = {
  currentActiveMemberCount: number;
  recordedActiveMemberCount: number;
  invalidActiveMemberCount: number;
  missingActiveMemberCount: number;
  archivedContributingMemberCount: number;
  trueCount: number;
  falseCount: number;
  numericValidCount: number;
  minValue: number | null;
  maxValue: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  zeroCount: number;
  negativeCount: number;
  outlierCount: number;
};

export function mapCoverageDistributionRow(row: CoverageDistributionRawRow): CoverageDistributionAggregate {
  return {
    currentActiveMemberCount: Number(row.current_active_member_count),
    recordedActiveMemberCount: Number(row.recorded_active_member_count),
    invalidActiveMemberCount: Number(row.invalid_active_member_count),
    missingActiveMemberCount: Number(row.missing_active_member_count),
    archivedContributingMemberCount: Number(row.archived_contributing_member_count),
    trueCount: Number(row.true_count),
    falseCount: Number(row.false_count),
    numericValidCount: Number(row.numeric_valid_count),
    minValue: row.min_value,
    maxValue: row.max_value,
    p25: row.p25,
    p50: row.p50,
    p75: row.p75,
    zeroCount: Number(row.zero_count),
    negativeCount: Number(row.negative_count),
    outlierCount: Number(row.outlier_count),
  };
}

/**
 * One coverage+distribution aggregate row per (active-attached) metric, for
 * one alliance's current period, computed entirely in PostgreSQL: latest
 * value per member via `DISTINCT ON` (same technique as
 * `getAlliancePerformanceReport.ts`), cross-joined against the roster so
 * "missing" is a real count rather than an absence, with percentiles and
 * the Tukey-fence outlier count derived from a `PERCENTILE_CONT` CTE.
 *
 * `MemberMetricEntry.value` is a Postgres `INTEGER` column (see
 * `prisma/schema.prisma`), which cannot represent `NaN` or `+/-Infinity` --
 * unlike a floating-point column, every non-null value here is already a
 * finite integer, so no separate finite-value validation is needed.
 */
async function queryCoverageAndDistribution(
  tx: AuditTxClient,
  allianceId: string,
  periodId: string,
  metricIds: string[],
): Promise<Map<string, CoverageDistributionAggregate>> {
  if (metricIds.length === 0) return new Map();

  const rows = await tx.$queryRaw<CoverageDistributionRawRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("metricId", "allianceMemberId")
        "metricId" AS metric_id, "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" IN (${Prisma.join(metricIds)})
      ORDER BY "metricId", "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    ),
    metric_types AS (
      SELECT id AS metric_id, (type = 'BOOLEAN'::"Metric_Type") AS is_boolean
      FROM "Metric"
      WHERE id IN (${Prisma.join(metricIds)}) AND "allianceId" = ${allianceId}
    ),
    cells AS (
      SELECT
        mt.metric_id,
        mt.is_boolean,
        am.id AS member_id,
        (am."archivedAt" IS NULL) AS is_active,
        l.value,
        (l.value IS NOT NULL AND (NOT mt.is_boolean OR l.value IN (0, 1))) AS is_valid
      FROM metric_types mt
      CROSS JOIN "AllianceMember" am
      LEFT JOIN latest l ON l.metric_id = mt.metric_id AND l.member_id = am.id
      WHERE am."allianceId" = ${allianceId}
    ),
    percentiles AS (
      SELECT
        metric_id,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY value) AS p25,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value) AS p75
      FROM cells
      WHERE is_valid AND NOT is_boolean
      GROUP BY metric_id
    )
    SELECT
      c.metric_id,
      COUNT(*) FILTER (WHERE c.is_active)::bigint AS current_active_member_count,
      COUNT(*) FILTER (WHERE c.is_active AND c.is_valid)::bigint AS recorded_active_member_count,
      COUNT(*) FILTER (WHERE c.is_active AND c.value IS NOT NULL AND NOT c.is_valid)::bigint AS invalid_active_member_count,
      COUNT(*) FILTER (WHERE c.is_active AND c.value IS NULL)::bigint AS missing_active_member_count,
      COUNT(*) FILTER (WHERE NOT c.is_active AND c.is_valid)::bigint AS archived_contributing_member_count,
      COUNT(*) FILTER (WHERE c.is_valid AND c.is_boolean AND c.value = 1)::bigint AS true_count,
      COUNT(*) FILTER (WHERE c.is_valid AND c.is_boolean AND c.value = 0)::bigint AS false_count,
      COUNT(*) FILTER (WHERE c.is_valid AND NOT c.is_boolean)::bigint AS numeric_valid_count,
      MIN(c.value) FILTER (WHERE c.is_valid AND NOT c.is_boolean) AS min_value,
      MAX(c.value) FILTER (WHERE c.is_valid AND NOT c.is_boolean) AS max_value,
      MAX(p.p25) AS p25,
      MAX(p.p50) AS p50,
      MAX(p.p75) AS p75,
      COUNT(*) FILTER (WHERE c.is_valid AND NOT c.is_boolean AND c.value = 0)::bigint AS zero_count,
      COUNT(*) FILTER (WHERE c.is_valid AND NOT c.is_boolean AND c.value < 0)::bigint AS negative_count,
      COUNT(*) FILTER (
        WHERE c.is_valid AND NOT c.is_boolean AND p.p25 IS NOT NULL AND (
          c.value < (p.p25 - 1.5 * (p.p75 - p.p25)) OR c.value > (p.p75 + 1.5 * (p.p75 - p.p25))
        )
      )::bigint AS outlier_count
    FROM cells c
    LEFT JOIN percentiles p ON p.metric_id = c.metric_id
    GROUP BY c.metric_id
  `;

  const map = new Map<string, CoverageDistributionAggregate>();
  for (const row of rows) {
    map.set(row.metric_id, mapCoverageDistributionRow(row));
  }
  return map;
}

// ---------------------------------------------------------------------------
// DB-side dogfood-readiness query: does a metric have real, valid data in
// enough distinct periods -- not merely an active attachment to enough
// periods with nothing ever entered.
// ---------------------------------------------------------------------------

type PeriodsWithValidDataRawRow = { metric_id: string; periods_with_valid_data_count: bigint };

async function queryPeriodsWithValidDataCounts(
  tx: AuditTxClient,
  allianceId: string,
  metricIds: string[],
): Promise<Map<string, number>> {
  if (metricIds.length === 0) return new Map();

  // Every join below is explicitly re-scoped to `allianceId` -- `Metric`,
  // `MetricPeriod`, and `AllianceMember` each carry their own `allianceId`
  // column, but nothing at the FK level stops a `MetricPeriodMetric` or
  // `MemberMetricEntry` row from pairing an in-allowlist metric with an
  // out-of-scope period/member (whether from a bug, a bad migration, or
  // inconsistent data). Re-checking `allianceId` at every join is
  // defense-in-depth against exactly that (ADR-002: never assume a single
  // alliance), independent of whether such a row could exist today.
  const rows = await tx.$queryRaw<PeriodsWithValidDataRawRow[]>`
    WITH attached_periods AS (
      SELECT DISTINCT mpm."periodId" AS period_id, mpm."metricId" AS metric_id
      FROM "MetricPeriodMetric" mpm
      JOIN "MetricPeriod" mp ON mp.id = mpm."periodId" AND mp."allianceId" = ${allianceId}
      WHERE mpm."metricId" IN (${Prisma.join(metricIds)}) AND mpm.active = true
    ),
    latest AS (
      SELECT DISTINCT ON (mme."periodId", mme."metricId", mme."allianceMemberId")
        mme."periodId" AS period_id, mme."metricId" AS metric_id, mme.value
      FROM "MemberMetricEntry" mme
      JOIN attached_periods ap ON ap.period_id = mme."periodId" AND ap.metric_id = mme."metricId"
      JOIN "AllianceMember" am ON am.id = mme."allianceMemberId" AND am."allianceId" = ${allianceId}
      ORDER BY mme."periodId", mme."metricId", mme."allianceMemberId", mme."recordedAt" DESC, mme."createdAt" DESC, mme.id DESC
    ),
    metric_types AS (
      SELECT id AS metric_id, (type = 'BOOLEAN'::"Metric_Type") AS is_boolean
      FROM "Metric"
      WHERE id IN (${Prisma.join(metricIds)}) AND "allianceId" = ${allianceId}
    ),
    -- Uses attached_periods/latest's already-alliance-scoped joins above.
    valid_periods AS (
      SELECT DISTINCT l.period_id, l.metric_id
      FROM latest l
      JOIN metric_types mt ON mt.metric_id = l.metric_id
      WHERE l.value IS NOT NULL AND (NOT mt.is_boolean OR l.value IN (0, 1))
    )
    SELECT metric_id, COUNT(*)::bigint AS periods_with_valid_data_count
    FROM valid_periods
    GROUP BY metric_id
  `;

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.metric_id, Number(row.periods_with_valid_data_count));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function countBy<T extends string>(values: readonly T[], allowedValues: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(allowedValues.map((value) => [value, 0])) as Record<T, number>;
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

function buildMetricConfigurationStats(metrics: readonly MetricWithAttachments[]): MetricConfigurationStats {
  const allAttachments = metrics.flatMap((metric) => metric.periodMetrics);
  return {
    totalMetricCount: metrics.length,
    activeMetricCount: metrics.filter((metric) => metric.active).length,
    archivedMetricCount: metrics.filter((metric) => !metric.active).length,
    byType: countBy(metrics.map((metric) => metric.type), Object.values(Metric_Type)),
    bySummaryKind: countBy(metrics.map((metric) => metric.summaryKind), Object.values(MetricSummaryKind)),
    byTrendDirection: countBy(metrics.map((metric) => metric.trendDirection), Object.values(MetricTrendDirection)),
    activeAttachmentCount: allAttachments.filter((attachment) => attachment.active).length,
    inactiveAttachmentCount: allAttachments.filter((attachment) => !attachment.active).length,
  };
}

function findCurrentPeriod(periods: readonly PeriodRow[]): PeriodRow | null {
  const activePeriods = periods.filter((period) => period.active);
  return pickCurrentMetricPeriod(activePeriods);
}

function buildCurrentPeriodWeightStats(
  currentPeriod: PeriodRow | null,
  metrics: readonly MetricWithAttachments[],
): CurrentPeriodWeightStats {
  if (!currentPeriod) return { currentPeriodFound: false };

  const activeComponents = metrics.flatMap((metric) =>
    metric.periodMetrics.filter((pm) => pm.periodId === currentPeriod.id && pm.active),
  );

  return {
    currentPeriodFound: true,
    activeComponentCount: activeComponents.length,
    zeroWeightComponentCount: activeComponents.filter((pm) => pm.weight === 0).length,
    requiredComponentCount: activeComponents.filter((pm) => pm.required).length,
    weightSum: activeComponents.reduce((sum, pm) => sum + pm.weight, 0),
  };
}

function buildNumericSection(aggregate: CoverageDistributionAggregate): NumericMetricDistributionSection {
  return {
    kind: "NUMERIC",
    distribution:
      aggregate.numericValidCount > 0
        ? {
            count: aggregate.numericValidCount,
            min: aggregate.minValue!,
            max: aggregate.maxValue!,
            p25: aggregate.p25!,
            p50: aggregate.p50!,
            p75: aggregate.p75!,
            zeroCount: aggregate.zeroCount,
            negativeCount: aggregate.negativeCount,
            outlierCount: aggregate.outlierCount,
          }
        : null,
  };
}

function buildBooleanSection(aggregate: CoverageDistributionAggregate): BooleanMetricDistributionSection {
  return { kind: "BOOLEAN", counts: { trueCount: aggregate.trueCount, falseCount: aggregate.falseCount } };
}

async function buildMetricDistributionRows(
  tx: AuditTxClient,
  allianceId: string,
  currentPeriod: PeriodRow | null,
  metrics: readonly MetricWithAttachments[],
): Promise<MetricDistributionRow[]> {
  if (!currentPeriod) return [];

  const activeAttachedMetrics = metrics.filter((metric) =>
    metric.periodMetrics.some((pm) => pm.periodId === currentPeriod.id && pm.active),
  );
  if (activeAttachedMetrics.length === 0) return [];

  const metricLabels = assignPseudonymousMetricLabels(activeAttachedMetrics.map((metric) => metric.id));
  const aggregates = await queryCoverageAndDistribution(
    tx,
    allianceId,
    currentPeriod.id,
    activeAttachedMetrics.map((metric) => metric.id),
  );

  return activeAttachedMetrics.map((metric) => {
    const aggregate =
      aggregates.get(metric.id) ??
      ({
        currentActiveMemberCount: 0,
        recordedActiveMemberCount: 0,
        invalidActiveMemberCount: 0,
        missingActiveMemberCount: 0,
        archivedContributingMemberCount: 0,
        trueCount: 0,
        falseCount: 0,
        numericValidCount: 0,
        minValue: null,
        maxValue: null,
        p25: null,
        p50: null,
        p75: null,
        zeroCount: 0,
        negativeCount: 0,
        outlierCount: 0,
      } satisfies CoverageDistributionAggregate);

    const coverage: MetricCoverageStats = {
      currentActiveMemberCount: aggregate.currentActiveMemberCount,
      recordedActiveMemberCount: aggregate.recordedActiveMemberCount,
      invalidActiveMemberCount: aggregate.invalidActiveMemberCount,
      missingActiveMemberCount: aggregate.missingActiveMemberCount,
    };

    const stats: MetricRowStats = {
      coverage,
      archivedContributingMemberCount: aggregate.archivedContributingMemberCount,
      section: metric.type === Metric_Type.BOOLEAN ? buildBooleanSection(aggregate) : buildNumericSection(aggregate),
    };

    // totalValidCount = recordedActiveMemberCount + archivedContributingMemberCount
    // EXACTLY (numericValidCount/trueCount+falseCount both span active AND
    // archived members -- see queryCoverageAndDistribution). Every count in
    // that relationship must suppress together, or the one left out is
    // recoverable from the other two by subtraction. The section's OWN
    // internal breakdown (trueCount/falseCount; zero/negative/outlier
    // counts) must join the same bundle too: e.g. 10 valid values split
    // 9/1 has a "large" total (10) but still discloses an exact one-member
    // subgroup (falseCount=1) unless that breakdown is part of the gate.
    const totalValidCount = aggregate.numericValidCount + aggregate.trueCount + aggregate.falseCount;

    return {
      metricLabel: metricLabels.get(metric.id)!,
      summaryKind: metric.summaryKind,
      trendDirection: metric.trendDirection,
      stats: suppressCorrelatedCounts(
        [
          aggregate.currentActiveMemberCount,
          aggregate.recordedActiveMemberCount,
          aggregate.invalidActiveMemberCount,
          aggregate.missingActiveMemberCount,
          aggregate.archivedContributingMemberCount,
          totalValidCount,
          aggregate.trueCount,
          aggregate.falseCount,
          aggregate.zeroCount,
          aggregate.negativeCount,
          aggregate.outlierCount,
        ],
        stats,
      ),
    };
  });
}

async function buildMetricStabilityStats(
  metrics: readonly MetricWithAttachments[],
  periods: readonly PeriodRow[],
): Promise<MetricStabilityStats> {
  const datedPeriods = periods.filter(
    (period): period is PeriodRow & { startsAt: Date; endsAt: Date } =>
      period.startsAt !== null && period.endsAt !== null,
  );

  const snapshots: AuditPeriodAttachmentSnapshot[] = datedPeriods.map((period) => {
    const activeComponents = new Map<string, number>();
    for (const metric of metrics) {
      const attachment = metric.periodMetrics.find((pm) => pm.periodId === period.id && pm.active);
      if (attachment) activeComponents.set(metric.id, attachment.weight);
    }
    return { periodId: period.id, startsAt: period.startsAt, endsAt: period.endsAt, activeComponents };
  });

  return computeMetricStabilityStats(snapshots);
}

async function buildDogfoodReadinessStats(
  tx: AuditTxClient,
  allianceId: string,
  metrics: readonly MetricWithAttachments[],
): Promise<DogfoodReadinessStats> {
  const periodsWithValidData = await queryPeriodsWithValidDataCounts(
    tx,
    allianceId,
    metrics.map((metric) => metric.id),
  );

  const metricsWithEnoughObservationsCount = metrics.filter(
    (metric) => (periodsWithValidData.get(metric.id) ?? 0) >= MIN_PERIODS_FOR_DOGFOOD,
  ).length;

  return {
    totalMetricCount: metrics.length,
    metricsWithEnoughObservationsCount,
    minPeriodsForDogfood: MIN_PERIODS_FOR_DOGFOOD,
  };
}

async function buildAllianceAuditSection(
  tx: AuditTxClient,
  allianceId: string,
  label: string,
): Promise<AllianceAuditSection> {
  const [metrics, periods] = await Promise.all([loadAllianceMetrics(tx, allianceId), loadAlliancePeriods(tx, allianceId)]);

  const currentPeriod = findCurrentPeriod(periods);

  return {
    label,
    comparablePeriods: computeComparablePeriodStats(periods),
    metricConfiguration: buildMetricConfigurationStats(metrics),
    currentPeriodWeights: buildCurrentPeriodWeightStats(currentPeriod, metrics),
    metricDistributions: await buildMetricDistributionRows(tx, allianceId, currentPeriod, metrics),
    metricStability: await buildMetricStabilityStats(metrics, periods),
    dogfoodReadiness: await buildDogfoodReadinessStats(tx, allianceId, metrics),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Runs the full audit for exactly the allowlisted alliances, inside the
 * caller's read-only transaction. Throws `AllianceAllowlistError` (see
 * `apsAuditAllowlist.ts`) before any other query runs if the allowlist is
 * empty, has duplicates, or contains an id that doesn't resolve.
 */
export async function runApsDataReadinessAudit(
  tx: AuditTxClient,
  allianceIds: readonly string[],
): Promise<ApsDataReadinessAuditReport> {
  const resolvedIds = await validateAllianceAllowlist(tx, allianceIds);
  const labels = assignPseudonymousAllianceLabels(resolvedIds);

  const alliances: AllianceAuditSection[] = [];
  for (const allianceId of resolvedIds) {
    alliances.push(await buildAllianceAuditSection(tx, allianceId, labels.get(allianceId)!));
  }
  // Sort by label, not by input/db order, so output order never leaks the
  // allowlist's original ordering.
  alliances.sort((a, b) => a.label.localeCompare(b.label));

  return {
    generatedAt: new Date().toISOString(),
    allianceCount: alliances.length,
    minCellSize: MIN_CELL_SIZE,
    minPeriodsForDogfood: MIN_PERIODS_FOR_DOGFOOD,
    alliances,
    limitations: LIMITATIONS,
  };
}
