import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/app/src/lib/prisma";
import {
  resolveComparisonPeriodSelection,
  type ComparablePeriodCandidate,
  type EligiblePeriodOption,
} from "@/app/src/lib/reports/resolveComparablePeriod";
import {
  buildMetricRollup,
  computeRollupChange,
  mapAggregateRow,
  type AggregateRawRow,
  type AggregateSnapshot,
  type MetricCoverage,
  type MetricInfo,
  type MetricPeriodAttachmentStatus,
  type MetricPeriodDataStatus,
  type MetricRollup,
  type PeriodInfo,
} from "@/app/src/lib/reports/getMetricSummaryReport";

/**
 * Bulk alliance-wide performance report read model (#264).
 *
 * Where `getMetricSummaryReport` (#190) answers "how is *this one metric*
 * doing," this answers "how is the *alliance* doing" — every configured
 * metric, one shared period and one shared comparison period, in a bounded
 * number of DB round-trips regardless of how many metrics the alliance has
 * configured. It deliberately does not paginate/sort/filter/search a member
 * roster (that's the member matrix, a later PR in #264) — every number here
 * comes from full-cohort, DB-side aggregates.
 *
 * `schemaVersion` exists so a future consumer (e.g. an AI interpretation
 * layer sitting on top of this report — see the linked follow-up issue for
 * Orion-assisted interpretation) can detect when the shape of this contract
 * changes, without this module needing to know that consumer exists.
 */

export const ALLIANCE_PERFORMANCE_REPORT_SCHEMA_VERSION = 1 as const;

export class AlliancePerformanceReportNotFoundError extends Error {
  constructor() {
    super("period not found");
    this.name = "AlliancePerformanceReportNotFoundError";
  }
}

export type AllianceMetricComparison =
  | { status: "NO_ROLLUP" }
  | { status: "NOT_ATTACHED" }
  | { status: "INACTIVE_ATTACHMENT" }
  | { status: "NO_DATA_IN_SELECTED_PERIOD" }
  | { status: "NO_DATA_IN_COMPARISON_PERIOD" }
  | {
      status: "COMPARED";
      rollup: MetricRollup;
      /** Selected minus comparison, in the rollup's native unit. */
      absoluteChange: number | null;
      /** Relative percentage change. Only meaningful for SUM/AVERAGE; always null for TRUE_RATE. */
      percentageChange: number | null;
    };

export type AllianceMetricPerformance = {
  metric: MetricInfo;
  attachmentStatus: MetricPeriodAttachmentStatus;
  dataStatus: MetricPeriodDataStatus;
  rollup: MetricRollup;
  coverage: MetricCoverage;
  /**
   * Null exactly when the alliance-wide `comparisonSelection` isn't
   * `RESOLVED` (no shared comparison period is in effect at all). Once a
   * shared period is resolved, every metric reports honestly against it —
   * `NO_ROLLUP`/`NOT_ATTACHED`/`INACTIVE_ATTACHMENT`/no-data are as
   * legitimate an answer as `COMPARED`, never silently omitted.
   */
  comparison: AllianceMetricComparison | null;
};

export type AllianceComparisonSelection =
  | { status: "NO_ELIGIBLE_PERIOD" }
  | {
      status: "INVALID_COMPARISON_PERIOD";
      requestedPeriodId: string;
      recommended: EligiblePeriodOption | null;
      eligiblePeriods: EligiblePeriodOption[];
    }
  | { status: "RESOLVED"; period: EligiblePeriodOption; eligiblePeriods: EligiblePeriodOption[] };

/**
 * Coverage across *active attachments only* (#264 spec): a metric that
 * isn't attached, or whose attachment is inactive, has no cells a member
 * could possibly have filled in this period, so counting its roster as
 * "missing" would misrepresent genuine gaps as identical to structurally
 * impossible ones. `notAttachedCount`/`inactiveAttachmentCount` surface
 * those metrics separately instead.
 */
export type AllianceOverallCoverage = {
  activeAttachmentCount: number;
  notAttachedCount: number;
  inactiveAttachmentCount: number;
  /** Sum of `currentActiveMemberCount` across active-attachment metrics only. */
  expectedCells: number;
  /** Sum of `recordedActiveMemberCount` (valid, non-invalid) across active-attachment metrics only. */
  recordedCells: number;
  /** Null when there are no active attachments to measure. */
  coveragePercent: number | null;
};

export type AlliancePerformanceReport = {
  schemaVersion: typeof ALLIANCE_PERFORMANCE_REPORT_SCHEMA_VERSION;
  generatedAt: Date;
  allianceId: string;
  period: PeriodInfo;
  comparisonSelection: AllianceComparisonSelection;
  /** Stable order: active metrics first, then name, then id — never reordered by findings/severity. */
  metrics: AllianceMetricPerformance[];
  overallCoverage: AllianceOverallCoverage;
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable directly, no Prisma/DB involved)
// ---------------------------------------------------------------------------

export function zeroAggregateSnapshot(): AggregateSnapshot {
  return {
    sumValue: 0,
    averageValue: null,
    trueCount: 0,
    falseCount: 0,
    invalidCount: 0,
    hasNegativeValues: false,
    currentActiveMemberCount: 0,
    recordedActiveMemberCount: 0,
    invalidActiveMemberCount: 0,
    missingActiveMemberCount: 0,
    archivedContributingMemberCount: 0,
    latestEntryCount: 0,
  };
}

/**
 * Per-metric comparison status against the alliance's single shared
 * comparison period. Order matters: a metric with no rollup at all is
 * checked first (there's nothing to compare regardless of attachment), then
 * whether the *selected* period has data (comparing against a fabricated
 * zero would misrepresent "nothing recorded yet" as a measured decline),
 * then the comparison period's own attachment/data state.
 */
export function buildAllianceMetricComparison(params: {
  summaryKind: MetricSummaryKind;
  selectedDataStatus: MetricPeriodDataStatus;
  selectedRollup: MetricRollup;
  comparisonAttachmentStatus: MetricPeriodAttachmentStatus;
  comparisonAggregate: AggregateSnapshot;
}): AllianceMetricComparison {
  const { summaryKind, selectedDataStatus, selectedRollup, comparisonAttachmentStatus, comparisonAggregate } =
    params;

  if (summaryKind === MetricSummaryKind.NONE) {
    return { status: "NO_ROLLUP" };
  }
  if (selectedDataStatus === "NO_VALUES") {
    return { status: "NO_DATA_IN_SELECTED_PERIOD" };
  }
  if (comparisonAttachmentStatus === "NOT_ATTACHED") {
    return { status: "NOT_ATTACHED" };
  }
  if (comparisonAttachmentStatus === "INACTIVE") {
    return { status: "INACTIVE_ATTACHMENT" };
  }
  if (comparisonAggregate.latestEntryCount === 0) {
    return { status: "NO_DATA_IN_COMPARISON_PERIOD" };
  }

  const comparisonRollup = buildMetricRollup(summaryKind, comparisonAggregate);
  const { absoluteChange, percentageChange } = computeRollupChange(summaryKind, selectedRollup, comparisonRollup);
  return { status: "COMPARED", rollup: comparisonRollup, absoluteChange, percentageChange };
}

export function computeOverallCoverage(
  metrics: readonly { attachmentStatus: MetricPeriodAttachmentStatus; coverage: MetricCoverage }[],
): AllianceOverallCoverage {
  let activeAttachmentCount = 0;
  let notAttachedCount = 0;
  let inactiveAttachmentCount = 0;
  let expectedCells = 0;
  let recordedCells = 0;

  for (const m of metrics) {
    if (m.attachmentStatus === "ACTIVE") {
      activeAttachmentCount += 1;
      expectedCells += m.coverage.currentActiveMemberCount;
      recordedCells += m.coverage.recordedActiveMemberCount;
    } else if (m.attachmentStatus === "NOT_ATTACHED") {
      notAttachedCount += 1;
    } else {
      inactiveAttachmentCount += 1;
    }
  }

  return {
    activeAttachmentCount,
    notAttachedCount,
    inactiveAttachmentCount,
    expectedCells,
    recordedCells,
    coveragePercent: expectedCells > 0 ? (recordedCells / expectedCells) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Raw SQL orchestration
// ---------------------------------------------------------------------------

type BulkAggregateRawRow = AggregateRawRow & { metric_id: string };

/**
 * One rollup+coverage aggregate per metric, in a single query, for the
 * entire cohort (active and archived contributors). Structurally the same
 * per-metric shape as `getMetricSummaryReport`'s `queryAggregate`, but
 * cross-joins every metric in the universe against every alliance member at
 * once (`metric_types` x `AllianceMember`) instead of looping one query per
 * metric — a metric with zero attachment/entries still gets a full row of
 * honest zeros/nulls via that cross join, so "not attached" and "attached
 * but empty" never need special-casing here.
 */
async function queryBulkAggregates(
  allianceId: string,
  periodId: string,
  metricIds: string[],
): Promise<Map<string, AggregateSnapshot>> {
  if (metricIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<BulkAggregateRawRow[]>`
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
      WHERE id IN (${Prisma.join(metricIds)})
    ),
    cells AS (
      SELECT
        mt.metric_id,
        mt.is_boolean,
        am.id AS member_id,
        (am."archivedAt" IS NULL) AS is_active,
        l.value
      FROM metric_types mt
      CROSS JOIN "AllianceMember" am
      LEFT JOIN latest l ON l.metric_id = mt.metric_id AND l.member_id = am.id
      WHERE am."allianceId" = ${allianceId}
    )
    SELECT
      metric_id,
      COALESCE(SUM(value) FILTER (
        WHERE value IS NOT NULL AND (NOT is_boolean OR value IN (0, 1))
      ), 0)::bigint AS sum_value,
      AVG(value) FILTER (
        WHERE value IS NOT NULL AND (NOT is_boolean OR value IN (0, 1))
      )::float8 AS avg_value,
      COUNT(*) FILTER (WHERE is_boolean AND value = 1)::bigint AS true_count,
      COUNT(*) FILTER (WHERE is_boolean AND value = 0)::bigint AS false_count,
      COUNT(*) FILTER (
        WHERE is_boolean AND value IS NOT NULL AND value NOT IN (0, 1)
      )::bigint AS invalid_count,
      COALESCE(BOOL_OR(value IS NOT NULL AND value < 0), FALSE) AS has_negative_values,
      COUNT(*) FILTER (WHERE is_active)::bigint AS current_active_member_count,
      COUNT(*) FILTER (
        WHERE is_active AND value IS NOT NULL AND (NOT is_boolean OR value IN (0, 1))
      )::bigint AS recorded_active_member_count,
      COUNT(*) FILTER (
        WHERE is_active AND is_boolean AND value IS NOT NULL AND value NOT IN (0, 1)
      )::bigint AS invalid_active_member_count,
      COUNT(*) FILTER (WHERE is_active AND value IS NULL)::bigint AS missing_active_member_count,
      COUNT(*) FILTER (
        WHERE NOT is_active AND value IS NOT NULL
      )::bigint AS archived_contributing_member_count,
      COUNT(*) FILTER (WHERE value IS NOT NULL)::bigint AS latest_entry_count
    FROM cells
    GROUP BY metric_id
  `;

  const map = new Map<string, AggregateSnapshot>();
  for (const row of rows) {
    map.set(row.metric_id, mapAggregateRow(row));
  }
  return map;
}

/** metricId -> periodId -> attachment active flag, for the (at most two) periods this report needs. */
async function loadAttachmentStatuses(
  metricIds: string[],
  periodIds: string[],
): Promise<Map<string, Map<string, boolean>>> {
  const map = new Map<string, Map<string, boolean>>();
  if (metricIds.length === 0 || periodIds.length === 0) return map;

  const rows = await prisma.metricPeriodMetric.findMany({
    where: { metricId: { in: metricIds }, periodId: { in: periodIds } },
    select: { metricId: true, periodId: true, active: true },
  });

  for (const row of rows) {
    if (!map.has(row.metricId)) map.set(row.metricId, new Map());
    map.get(row.metricId)!.set(row.periodId, row.active);
  }
  return map;
}

function resolveAttachmentStatus(
  attachmentMap: Map<string, Map<string, boolean>>,
  metricId: string,
  periodId: string,
): MetricPeriodAttachmentStatus {
  const active = attachmentMap.get(metricId)?.get(periodId);
  if (active === undefined) return "NOT_ATTACHED";
  return active ? "ACTIVE" : "INACTIVE";
}

/**
 * The alliance-wide performance report for one period (#264).
 *
 * Tenant scoping: `period` is looked up scoped to `allianceId`; a `periodId`
 * belonging to another alliance simply doesn't resolve and throws
 * `AlliancePerformanceReportNotFoundError`. Callers (server actions/pages)
 * must already have verified the acting user has access to `allianceId` —
 * this function trusts that boundary, matching every other alliance-scoped
 * read model in the app.
 *
 * Metric universe (deterministic, #264 spec):
 *   - Every active alliance-configured metric, even if not attached to this
 *     period or with no recorded values — those absences are exactly what
 *     the report exists to reveal.
 *   - An archived metric only when it has a `MetricPeriodMetric` attachment
 *     for this specific period (active or inactive) — a `MemberMetricEntry`
 *     can't exist without one, so this also covers "has historical results
 *     here." An archived metric with no relationship to this period is
 *     excluded entirely, rather than cluttering the report with unrelated
 *     library history.
 *
 * Comparison: exactly one shared earlier period applies to every metric —
 * never a silently different baseline chosen per metric. Structural
 * eligibility (same duration, non-overlapping, earlier) is delegated to
 * `resolveComparisonPeriodSelection` with `metricAttachedActive: true` set
 * on every candidate; that field is deliberately a synthetic constant here,
 * not a real per-metric attachment check — the alliance-wide selector has
 * no single metric's attachment to gate on, so structural comparability is
 * the whole test. Each metric's `comparison` then reports its own honest
 * relationship to that one resolved period.
 */
export async function getAlliancePerformanceReport(params: {
  allianceId: string;
  periodId: string;
  comparePeriodId?: string;
}): Promise<AlliancePerformanceReport> {
  const { allianceId, periodId, comparePeriodId } = params;

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
    select: { id: true, name: true, startsAt: true, endsAt: true, active: true },
  });
  if (!period) throw new AlliancePerformanceReportNotFoundError();

  const metrics = await prisma.metric.findMany({
    where: {
      allianceId,
      OR: [{ active: true }, { periodMetrics: { some: { periodId } } }],
    },
    select: { id: true, name: true, type: true, summaryKind: true, unitLabel: true, active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
  });
  const metricIds = metrics.map((m) => m.id);

  const comparisonCandidatesRaw = await prisma.metricPeriod.findMany({
    where: { allianceId, id: { not: periodId } },
    select: { id: true, name: true, startsAt: true, endsAt: true, createdAt: true },
    orderBy: [{ startsAt: "desc" }, { endsAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const comparisonCandidates: ComparablePeriodCandidate[] = comparisonCandidatesRaw.map((candidate) => ({
    ...candidate,
    metricAttachedActive: true,
  }));
  const comparisonSelection: AllianceComparisonSelection = resolveComparisonPeriodSelection({
    requestedPeriodId: comparePeriodId ?? null,
    candidates: comparisonCandidates,
    selected: { startsAt: period.startsAt, endsAt: period.endsAt },
  });
  const resolvedComparePeriodId =
    comparisonSelection.status === "RESOLVED" ? comparisonSelection.period.id : null;

  const attachmentPeriodIds = resolvedComparePeriodId ? [periodId, resolvedComparePeriodId] : [periodId];

  const [attachmentMap, selectedAggregates, comparisonAggregates] = await Promise.all([
    loadAttachmentStatuses(metricIds, attachmentPeriodIds),
    queryBulkAggregates(allianceId, periodId, metricIds),
    resolvedComparePeriodId
      ? queryBulkAggregates(allianceId, resolvedComparePeriodId, metricIds)
      : Promise.resolve(new Map<string, AggregateSnapshot>()),
  ]);

  const metricPerformances: AllianceMetricPerformance[] = metrics.map((metric) => {
    const aggregate = selectedAggregates.get(metric.id) ?? zeroAggregateSnapshot();
    const rollup = buildMetricRollup(metric.summaryKind, aggregate);
    const dataStatus: MetricPeriodDataStatus = aggregate.latestEntryCount > 0 ? "HAS_VALUES" : "NO_VALUES";
    const attachmentStatus = resolveAttachmentStatus(attachmentMap, metric.id, periodId);

    const coverage: MetricCoverage = {
      currentActiveMemberCount: aggregate.currentActiveMemberCount,
      recordedActiveMemberCount: aggregate.recordedActiveMemberCount,
      invalidActiveMemberCount: aggregate.invalidActiveMemberCount,
      missingActiveMemberCount: aggregate.missingActiveMemberCount,
      complete: aggregate.missingActiveMemberCount === 0 && aggregate.invalidActiveMemberCount === 0,
      archivedContributingMemberCount: aggregate.archivedContributingMemberCount,
    };

    let comparison: AllianceMetricComparison | null = null;
    if (resolvedComparePeriodId) {
      const comparisonAttachmentStatus = resolveAttachmentStatus(attachmentMap, metric.id, resolvedComparePeriodId);
      const comparisonAggregate = comparisonAggregates.get(metric.id) ?? zeroAggregateSnapshot();
      comparison = buildAllianceMetricComparison({
        summaryKind: metric.summaryKind,
        selectedDataStatus: dataStatus,
        selectedRollup: rollup,
        comparisonAttachmentStatus,
        comparisonAggregate,
      });
    }

    return {
      metric: {
        id: metric.id,
        name: metric.name,
        type: metric.type,
        summaryKind: metric.summaryKind,
        unitLabel: metric.unitLabel,
        active: metric.active,
      },
      attachmentStatus,
      dataStatus,
      rollup,
      coverage,
      comparison,
    };
  });

  const overallCoverage = computeOverallCoverage(metricPerformances);

  return {
    schemaVersion: ALLIANCE_PERFORMANCE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date(),
    allianceId,
    period: {
      id: period.id,
      name: period.name,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      active: period.active,
    },
    comparisonSelection,
    metrics: metricPerformances,
    overallCoverage,
  };
}
