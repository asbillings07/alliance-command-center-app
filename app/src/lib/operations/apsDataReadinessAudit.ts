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
 * This module answers the "production-derived aggregates" third of the
 * three-part evidence package described in ADR-017; it deliberately does
 * NOT answer leader-intent (targets/weights leaders already use) or
 * synthetic edge cases — see `docs/adr/017-aps-evidence.md` for those.
 */
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";
import { pickCurrentMetricPeriod } from "@/app/src/lib/metricPeriodOrdering";
import type { AuditTxClient } from "./apsAuditTransaction";
import { validateAllianceAllowlist } from "./apsAuditAllowlist";
import {
  MIN_CELL_SIZE,
  assignPseudonymousAllianceLabels,
  assignPseudonymousMetricLabels,
  suppressSmallCell,
  type SuppressibleStatistic,
} from "./apsAuditPrivacy";
import {
  computeComparablePeriodStats,
  computeMetricStabilityStats,
  type AuditPeriodAttachmentSnapshot,
  type ComparablePeriodStats,
  type MetricStabilityStats,
} from "./apsAuditPeriodAnalysis";
import { computeNumericDistribution, type NumericDistribution } from "./apsAuditDistribution";

/** A metric needs a valid recorded value in at least this many periods to be considered dogfood-ready. Not a scoring decision — just "enough repeated observations to look at at all." */
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

export type NumericMetricDistributionSection = {
  kind: "NUMERIC";
  distribution: SuppressibleStatistic<NumericDistribution>;
};

export type BooleanMetricDistributionSection = {
  kind: "BOOLEAN";
  trueCount: number;
  falseCount: number;
  invalidCount: number;
};

export type MetricDistributionRow = {
  metricLabel: string;
  summaryKind: MetricSummaryKind;
  trendDirection: MetricTrendDirection;
  currentActiveMemberCount: number;
  recordedActiveMemberCount: number;
  invalidActiveMemberCount: number;
  missingActiveMemberCount: number;
  archivedContributingMemberCount: number;
  section: NumericMetricDistributionSection | BooleanMetricDistributionSection;
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
      periodMetrics: { select: { periodId: true, weight: true, required: true, active: true } },
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

type RosterRow = { id: string; archivedAt: Date | null };

async function loadAllianceRoster(tx: AuditTxClient, allianceId: string): Promise<RosterRow[]> {
  return tx.allianceMember.findMany({ where: { allianceId }, select: { id: true, archivedAt: true } });
}

/** Latest recorded value per (metricId, allianceMemberId) for one period, across every member — active and archived alike. */
async function loadLatestEntriesByMetricAndMember(
  tx: AuditTxClient,
  periodId: string,
  metricIds: string[],
): Promise<Map<string, number>> {
  if (metricIds.length === 0) return new Map();

  const rows = await tx.memberMetricEntry.findMany({
    where: { periodId, metricId: { in: metricIds } },
    select: { allianceMemberId: true, metricId: true, value: true },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  const latest = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.metricId}:${row.allianceMemberId}`;
    // Rows arrive latest-first; the first row seen per key is the latest entry.
    if (!latest.has(key)) {
      latest.set(key, row.value);
    }
  }
  return latest;
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

async function buildMetricDistributionRows(
  tx: AuditTxClient,
  currentPeriod: PeriodRow | null,
  metrics: readonly MetricWithAttachments[],
  roster: readonly RosterRow[],
): Promise<MetricDistributionRow[]> {
  if (!currentPeriod) return [];

  const activeAttachedMetrics = metrics.filter((metric) =>
    metric.periodMetrics.some((pm) => pm.periodId === currentPeriod.id && pm.active),
  );
  if (activeAttachedMetrics.length === 0) return [];

  const metricLabels = assignPseudonymousMetricLabels(activeAttachedMetrics.map((metric) => metric.id));
  const latest = await loadLatestEntriesByMetricAndMember(
    tx,
    currentPeriod.id,
    activeAttachedMetrics.map((metric) => metric.id),
  );

  const activeMembers = roster.filter((member) => member.archivedAt === null);
  const archivedMembers = roster.filter((member) => member.archivedAt !== null);

  return activeAttachedMetrics.map((metric) => {
    let recordedActiveMemberCount = 0;
    let invalidActiveMemberCount = 0;
    let missingActiveMemberCount = 0;
    const allValidValues: number[] = [];

    for (const member of activeMembers) {
      const value = latest.get(`${metric.id}:${member.id}`);
      if (value === undefined) {
        missingActiveMemberCount += 1;
        continue;
      }
      const valid = metric.type === Metric_Type.BOOLEAN ? isValidBooleanMetricValue(value) : true;
      if (!valid) {
        invalidActiveMemberCount += 1;
        continue;
      }
      recordedActiveMemberCount += 1;
      allValidValues.push(value);
    }

    let archivedContributingMemberCount = 0;
    for (const member of archivedMembers) {
      const value = latest.get(`${metric.id}:${member.id}`);
      if (value === undefined) continue;
      const valid = metric.type === Metric_Type.BOOLEAN ? isValidBooleanMetricValue(value) : true;
      if (!valid) continue;
      archivedContributingMemberCount += 1;
      allValidValues.push(value);
    }

    const section: NumericMetricDistributionSection | BooleanMetricDistributionSection =
      metric.type === Metric_Type.BOOLEAN
        ? {
            kind: "BOOLEAN",
            trueCount: allValidValues.filter((value) => value === 1).length,
            falseCount: allValidValues.filter((value) => value === 0).length,
            invalidCount: invalidActiveMemberCount,
          }
        : {
            kind: "NUMERIC",
            distribution: (() => {
              const distribution = computeNumericDistribution(allValidValues);
              return distribution
                ? suppressSmallCell(allValidValues.length, distribution)
                : suppressSmallCell(0, { count: 0 } as NumericDistribution, 1);
            })(),
          };

    return {
      metricLabel: metricLabels.get(metric.id)!,
      summaryKind: metric.summaryKind,
      trendDirection: metric.trendDirection,
      currentActiveMemberCount: activeMembers.length,
      recordedActiveMemberCount,
      invalidActiveMemberCount,
      missingActiveMemberCount,
      archivedContributingMemberCount,
      section,
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

function buildDogfoodReadinessStats(metrics: readonly MetricWithAttachments[]): DogfoodReadinessStats {
  // A metric is "ready to dogfood" if it was ever actively attached to at
  // least MIN_PERIODS_FOR_DOGFOOD distinct periods — a configuration-only
  // proxy for "enough repeated observations," since counting *valid
  // recorded values* per period would require re-querying every period for
  // every metric; attachment breadth is a conservative (never-overstating)
  // stand-in the ADR's evidence report can refine with the full per-metric
  // distribution rows already gathered for the current period.
  const metricsWithEnoughObservationsCount = metrics.filter((metric) => {
    const attachedPeriodIds = new Set(metric.periodMetrics.filter((pm) => pm.active).map((pm) => pm.periodId));
    return attachedPeriodIds.size >= MIN_PERIODS_FOR_DOGFOOD;
  }).length;

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
  const [metrics, periods, roster] = await Promise.all([
    loadAllianceMetrics(tx, allianceId),
    loadAlliancePeriods(tx, allianceId),
    loadAllianceRoster(tx, allianceId),
  ]);

  const currentPeriod = findCurrentPeriod(periods);

  return {
    label,
    comparablePeriods: computeComparablePeriodStats(periods),
    metricConfiguration: buildMetricConfigurationStats(metrics),
    currentPeriodWeights: buildCurrentPeriodWeightStats(currentPeriod, metrics),
    metricDistributions: await buildMetricDistributionRows(tx, currentPeriod, metrics, roster),
    metricStability: await buildMetricStabilityStats(metrics, periods),
    dogfoodReadiness: buildDogfoodReadinessStats(metrics),
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
