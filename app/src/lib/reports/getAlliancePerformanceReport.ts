import "server-only";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/app/src/lib/prisma";
import {
  resolveComparisonPeriodSelection,
  type ComparablePeriodCandidate,
  type EligiblePeriodOption,
} from "@/app/src/lib/reports/resolveComparablePeriod";
import {
  buildMetricRollup,
  computeAggregateSnapshot,
  computeRollupChange,
  type AggregateSnapshot,
  type MetricCoverage,
  type MetricInfo,
  type MetricPeriodAttachmentStatus,
  type MetricPeriodDataStatus,
  type MetricRollup,
  type PeriodInfo,
} from "@/app/src/lib/reports/getMetricSummaryReport";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";

/**
 * Bulk alliance-wide performance report read model (#264).
 *
 * Where `getMetricSummaryReport` (#190) answers "how is *this one metric*
 * doing," this answers "how is the *alliance* doing" — every configured
 * metric, one shared period and one shared comparison period, in a bounded
 * number of DB round-trips regardless of how many metrics the alliance has
 * configured. It deliberately does not paginate/sort/filter/search a member
 * roster (that's the member matrix, a later PR in #264) — every number here
 * comes from full-cohort reads (the entire alliance roster, every
 * configured metric).
 *
 * #287 Slice 3: `queryBulkAggregates` sources its per-member values from
 * `memberPeriodMetricValues` (ADR-018 §6, the canonical member-period
 * rollup) instead of a hand-rolled raw SQL aggregate, and derives the
 * rollup/coverage counters via `computeAggregateSnapshot` (`metricRollup.ts`)
 * in JS rather than SQL `FILTER` clauses — see that function's doc comment
 * and `docs/database-design/287-slice3-consumer-parity-log.md`.
 *
 * `schemaVersion` exists so a future consumer (e.g. an AI interpretation
 * layer sitting on top of this report — see the linked follow-up issue for
 * Orion-assisted interpretation) can detect when the shape of this contract
 * changes, without this module needing to know that consumer exists. Bump
 * it whenever a field is added, removed, or reinterpreted on
 * `AlliancePerformanceReport` or anything it embeds (e.g. `MetricInfo`) —
 * 2 (#264 PR2) added the required `metric.trendDirection` field.
 */

export const ALLIANCE_PERFORMANCE_REPORT_SCHEMA_VERSION = 2 as const;

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
  /**
   * Sum of `recordedActiveMemberCount` across active-attachment metrics
   * only — i.e. cells with a *valid* value. An active member who submitted
   * an invalid legacy value still counts toward `expectedCells` but not
   * here, so this must never be surfaced to a leader as "recorded": with
   * one invalid entry and nothing else, "0 of 1 recorded" would falsely
   * imply nobody entered anything, when one member did (just invalidly).
   * Always label this "valid results," never "recorded."
   */
  validCells: number;
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
 * zero would misrepresent "nothing recorded yet" as a measured decrease),
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
  let validCells = 0;

  for (const m of metrics) {
    if (m.attachmentStatus === "ACTIVE") {
      activeAttachmentCount += 1;
      expectedCells += m.coverage.currentActiveMemberCount;
      validCells += m.coverage.recordedActiveMemberCount;
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
    validCells,
    coveragePercent: expectedCells > 0 ? (validCells / expectedCells) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Query orchestration
// ---------------------------------------------------------------------------

/**
 * One rollup+coverage aggregate per metric, for the entire cohort (active
 * and archived contributors), for one period.
 *
 * #287 Slice 3: previously a single hand-rolled raw SQL query per period
 * that cross-joined every metric against every alliance member at once
 * (`metric_types` x `AllianceMember`) and derived every counter via SQL
 * `FILTER` clauses. Now built from `memberPeriodMetricValues` (ADR-018 §6,
 * ADR-018's canonical member-period rollup) grouped by `metricId`, with
 * `computeAggregateSnapshot` (`metricRollup.ts`) doing the same per-metric
 * derivation in JS that `getMetricSummaryReport.ts` already uses for a
 * single metric — this is that same helper called once per metric here,
 * not a second implementation of the aggregation rules. See
 * `docs/database-design/287-slice3-consumer-parity-log.md`.
 *
 * `memberPeriodMetricValues` already returns one row per (metric, member)
 * pair for *every* requested `metricId` — including a metric with zero
 * entries in this period — via its own `requested_metrics x AllianceMember`
 * cross join, so "not attached" and "attached but empty" still never need
 * special-casing here; a metric with no rows in `valuesByMetric` simply
 * derives `computeAggregateSnapshot([], roster, ...)`, which is every
 * roster member mapped to a `null` value — identical to the old query's
 * `LEFT JOIN latest` producing an all-`NULL` row per member.
 *
 * `isBooleanByMetricId` comes from the caller's already-fetched `metrics`
 * (it needs `Metric.type` for other fields too), so this function doesn't
 * need its own `Metric` lookup the way the old raw SQL's `metric_types` CTE
 * did.
 *
 * Scalability note carried over from the prior implementation: this is
 * constant in DB round-trips (one `memberPeriodMetricValues` call + one
 * roster fetch here, run at most twice per request — selected period, and
 * again for the comparison period if one resolves — never once per
 * metric), but the intermediate rowset `memberPeriodMetricValues` returns
 * grows multiplicatively, as O(metrics × members), not just linearly with
 * either. At today's expected alliance/metric-library sizes (tens of
 * metrics, low hundreds of members) that's a few thousand rows — cheap —
 * but it's worth being explicit this doesn't hold indefinitely as either
 * dimension grows. If this ever needs revisiting, the concrete lever is
 * the same one noted before the #287 migration: per-member coverage counts
 * are only ever consumed by the UI for ACTIVE-attachment metrics, so the
 * cross join could be restricted to that period's active-attachment subset
 * of `metricIds`. Deferred until a real alliance/metric-library size or a
 * benchmark actually demonstrates this as a bottleneck.
 */
async function queryBulkAggregates(
  allianceId: string,
  periodId: string,
  metricIds: string[],
  isBooleanByMetricId: ReadonlyMap<string, boolean>,
): Promise<Map<string, AggregateSnapshot>> {
  if (metricIds.length === 0) return new Map();

  const [values, roster] = await Promise.all([
    memberPeriodMetricValues(allianceId, periodId, metricIds),
    prisma.allianceMember.findMany({
      where: { allianceId },
      select: { id: true, archivedAt: true },
    }),
  ]);

  const valuesByMetric = new Map<string, { allianceMemberId: string; value: number | null }[]>();
  for (const value of values) {
    const bucket = valuesByMetric.get(value.metricId);
    if (bucket) bucket.push(value);
    else valuesByMetric.set(value.metricId, [value]);
  }

  const map = new Map<string, AggregateSnapshot>();
  for (const metricId of metricIds) {
    const isBooleanMetric = isBooleanByMetricId.get(metricId) ?? false;
    map.set(metricId, computeAggregateSnapshot(valuesByMetric.get(metricId) ?? [], roster, isBooleanMetric));
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
    select: { id: true, name: true, type: true, summaryKind: true, unitLabel: true, active: true, trendDirection: true },
    orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
  });
  const metricIds = metrics.map((m) => m.id);
  const isBooleanByMetricId = new Map(metrics.map((m) => [m.id, m.type === Metric_Type.BOOLEAN]));

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
    queryBulkAggregates(allianceId, periodId, metricIds, isBooleanByMetricId),
    resolvedComparePeriodId
      ? queryBulkAggregates(allianceId, resolvedComparePeriodId, metricIds, isBooleanByMetricId)
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
        trendDirection: metric.trendDirection,
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
