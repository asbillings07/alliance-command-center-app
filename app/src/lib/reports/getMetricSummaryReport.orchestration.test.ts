import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metric: { findFirst: vi.fn() },
    metricPeriod: { findFirst: vi.fn(), findMany: vi.fn() },
    metricPeriodMetric: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/app/src/lib/prisma";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { getMetricSummaryReport, MetricSummaryReportNotFoundError } from "./getMetricSummaryReport";

const ALLIANCE_ID = "alliance-1";
const METRIC_ID = "metric-1";
const PERIOD_ID = "period-1";

const NUMERIC_METRIC = {
  id: METRIC_ID,
  name: "VS Score",
  type: Metric_Type.NUMERIC,
  summaryKind: MetricSummaryKind.SUM,
  unitLabel: "pts",
  active: true,
};

const SELECTED_PERIOD = {
  id: PERIOD_ID,
  name: "Week 12",
  startsAt: new Date("2026-03-01"),
  endsAt: new Date("2026-03-14"),
  active: true,
};

function zeroAggregateRow(overrides: Record<string, unknown> = {}) {
  return {
    sum_value: BigInt(0),
    avg_value: null,
    true_count: BigInt(0),
    false_count: BigInt(0),
    invalid_count: BigInt(0),
    has_negative_values: false,
    current_active_member_count: BigInt(0),
    recorded_active_member_count: BigInt(0),
    invalid_active_member_count: BigInt(0),
    missing_active_member_count: BigInt(0),
    archived_contributing_member_count: BigInt(0),
    latest_entry_count: BigInt(0),
    ...overrides,
  };
}

/**
 * Configures the standard call sequence: main aggregate, roster count,
 * visualization rows (only for the metric kinds that need them — see
 * `needsVisualizationRows` in getMetricSummaryReport.ts), roster rows.
 * Pass `visualizationRows: null` for a TRUE_RATE or NONE+BOOLEAN metric,
 * where that query is skipped entirely (#264 PR4).
 */
function mockCoreQueries(params: {
  aggregateRow?: ReturnType<typeof zeroAggregateRow>;
  totalRowCount?: number;
  visualizationRows?: unknown[] | null;
  rosterRows?: unknown[];
}) {
  const { aggregateRow = zeroAggregateRow(), totalRowCount = 0, visualizationRows = [], rosterRows = [] } = params;
  const mocked = vi
    .mocked(prisma.$queryRaw)
    .mockResolvedValueOnce([aggregateRow])
    .mockResolvedValueOnce([{ total: BigInt(totalRowCount) }]);
  if (visualizationRows !== null) {
    mocked.mockResolvedValueOnce(visualizationRows);
  }
  mocked.mockResolvedValueOnce(rosterRows);
}

describe("getMetricSummaryReport orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws MetricSummaryReportNotFoundError('metric') when the metric doesn't resolve for the alliance", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue(null);

    await expect(
      getMetricSummaryReport({ allianceId: ALLIANCE_ID, metricId: METRIC_ID, periodId: PERIOD_ID }),
    ).rejects.toThrow(MetricSummaryReportNotFoundError);

    expect(prisma.metric.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: METRIC_ID, allianceId: ALLIANCE_ID } }),
    );
  });

  it("throws MetricSummaryReportNotFoundError('period') when the period doesn't resolve for the alliance", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue(NUMERIC_METRIC as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue(null);

    await expect(
      getMetricSummaryReport({ allianceId: ALLIANCE_ID, metricId: METRIC_ID, periodId: PERIOD_ID }),
    ).rejects.toThrow(MetricSummaryReportNotFoundError);
  });

  it("reports NOT_ATTACHED and NO_VALUES when no MetricPeriodMetric row exists", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue({
      ...NUMERIC_METRIC,
      summaryKind: MetricSummaryKind.NONE,
    } as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue(null);
    mockCoreQueries({});

    const report = await getMetricSummaryReport({
      allianceId: ALLIANCE_ID,
      metricId: METRIC_ID,
      periodId: PERIOD_ID,
    });

    expect(report.attachmentStatus).toBe("NOT_ATTACHED");
    expect(report.dataStatus).toBe("NO_VALUES");
    // NONE-kind metrics never get a comparison section, and never trigger the candidates query.
    expect(report.comparison).toBeNull();
    expect(prisma.metricPeriod.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [true, "ACTIVE"],
    [false, "INACTIVE"],
  ] as const)("maps MetricPeriodMetric.active=%s to attachmentStatus %s", async (active, expected) => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue({
      ...NUMERIC_METRIC,
      summaryKind: MetricSummaryKind.NONE,
    } as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active } as never);
    mockCoreQueries({});

    const report = await getMetricSummaryReport({
      allianceId: ALLIANCE_ID,
      metricId: METRIC_ID,
      periodId: PERIOD_ID,
    });

    expect(report.attachmentStatus).toBe(expected);
  });

  it("reports HAS_VALUES when the aggregate has at least one latest entry", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue({
      ...NUMERIC_METRIC,
      summaryKind: MetricSummaryKind.NONE,
    } as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
    mockCoreQueries({ aggregateRow: zeroAggregateRow({ latest_entry_count: BigInt(3) }) });

    const report = await getMetricSummaryReport({
      allianceId: ALLIANCE_ID,
      metricId: METRIC_ID,
      periodId: PERIOD_ID,
    });

    expect(report.dataStatus).toBe("HAS_VALUES");
  });

  it("builds a SUM rollup and per-row shares from the aggregate + roster rows", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue(NUMERIC_METRIC as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
    mockCoreQueries({
      aggregateRow: zeroAggregateRow({ sum_value: BigInt(200), latest_entry_count: BigInt(2) }),
      totalRowCount: 2,
      rosterRows: [
        { alliance_member_id: "m1", player_name: "Alice", archived: false, value: 150, rank: BigInt(1) },
        { alliance_member_id: "m2", player_name: "Bob", archived: false, value: 50, rank: BigInt(2) },
      ],
    });
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);

    const report = await getMetricSummaryReport({
      allianceId: ALLIANCE_ID,
      metricId: METRIC_ID,
      periodId: PERIOD_ID,
    });

    expect(report.rollup).toEqual({ kind: "SUM", total: 200, hasNegativeValues: false });
    expect(report.rows).toEqual([
      {
        allianceMemberId: "m1",
        playerName: "Alice",
        archived: false,
        value: 150,
        rank: 1,
        booleanStatus: null,
        share: { available: true, percentageOfTotal: 75 },
        differenceFromAverage: null,
      },
      {
        allianceMemberId: "m2",
        playerName: "Bob",
        archived: false,
        value: 50,
        rank: 2,
        booleanStatus: null,
        share: { available: true, percentageOfTotal: 25 },
        differenceFromAverage: null,
      },
    ]);
  });

  describe("visualization (#264 PR4)", () => {
    it("builds visualModel and interpretationSummary from the dedicated visualization query, independent of the roster's own rows", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue(NUMERIC_METRIC as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockCoreQueries({
        aggregateRow: zeroAggregateRow({ sum_value: BigInt(1000), latest_entry_count: BigInt(2) }),
        // The visualization query's cohort deliberately differs from the roster page below it —
        // this must drive the chart, not the (paginated, possibly filtered) roster rows.
        visualizationRows: [
          { alliance_member_id: "m1", player_name: "Alice", archived: false, value: 800 },
          { alliance_member_id: "m2", player_name: "Bob", archived: false, value: 200 },
        ],
        totalRowCount: 1,
        // Roster page shows only one row (e.g. searched/filtered) — the chart must still see both members.
        rosterRows: [{ alliance_member_id: "m1", player_name: "Alice", archived: false, value: 800, rank: BigInt(1) }],
      });
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.visualModel).toMatchObject({
        kind: "SUM",
        consideredCount: 2,
        topContributors: [
          expect.objectContaining({ allianceMemberId: "m1", value: 800 }),
          expect.objectContaining({ allianceMemberId: "m2", value: 200 }),
        ],
      });
      expect(report.interpretationSummary).toBe(
        "VS Score totaled 1,000 pts. The top 2 members accounted for 100% of the total.",
      );
    });

    it("passes the raw aggregate — not a filtered rows-derived recomputation — into a TRUE_RATE visual model, and skips the visualization query entirely", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue({
        ...NUMERIC_METRIC,
        type: "BOOLEAN",
        summaryKind: MetricSummaryKind.TRUE_RATE,
      } as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockCoreQueries({
        aggregateRow: zeroAggregateRow({
          true_count: BigInt(14),
          false_count: BigInt(4),
          invalid_count: BigInt(1),
          recorded_active_member_count: BigInt(18),
          missing_active_member_count: BigInt(2),
          current_active_member_count: BigInt(20),
          latest_entry_count: BigInt(19),
        }),
        // TRUE_RATE's visual model is sourced entirely from `aggregate` —
        // the visualization query itself must never run for it (#264 PR4:
        // running an unused full-cohort query has no functional benefit).
        visualizationRows: null,
      });
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.visualModel).toEqual({
        kind: "TRUE_RATE",
        trueCount: 14,
        falseCount: 4,
        invalidCount: 1,
        recordedActiveMemberCount: 18,
        missingActiveMemberCount: 2,
        currentActiveMemberCount: 20,
      });
      expect(report.interpretationSummary).toBe(
        "14 of 18 valid responses were Yes. 2 active members have no recorded response.",
      );
      // Exactly 3 calls: aggregate, roster count, roster rows — no
      // visualization query.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it("skips the visualization query for a NONE+BOOLEAN metric too, sourcing its visual model from aggregate", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue({
        ...NUMERIC_METRIC,
        type: "BOOLEAN",
        summaryKind: MetricSummaryKind.NONE,
      } as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockCoreQueries({
        aggregateRow: zeroAggregateRow({
          true_count: BigInt(5),
          false_count: BigInt(5),
          latest_entry_count: BigInt(10),
        }),
        visualizationRows: null,
      });

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.visualModel).toMatchObject({ kind: "NONE", valueKind: "BOOLEAN", trueCount: 5, falseCount: 5 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it("still runs the visualization query for a NONE+NUMERIC metric, which needs per-member values", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue({
        ...NUMERIC_METRIC,
        summaryKind: MetricSummaryKind.NONE,
      } as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockCoreQueries({
        aggregateRow: zeroAggregateRow({ latest_entry_count: BigInt(2) }),
        visualizationRows: [
          { alliance_member_id: "m1", player_name: "Alice", archived: false, value: 10 },
          { alliance_member_id: "m2", player_name: "Bob", archived: false, value: 20 },
        ],
      });

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.visualModel).toMatchObject({ kind: "NONE", valueKind: "NUMERIC", validCount: 2 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    });
  });

  it("clamps an out-of-range requested page down to the last real page before running the row query", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue({
      ...NUMERIC_METRIC,
      summaryKind: MetricSummaryKind.NONE,
    } as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
    // 55 total rows at page size 25 -> 3 pages; requesting page 99 must clamp to page 3.
    mockCoreQueries({ totalRowCount: 55, rosterRows: [] });

    const report = await getMetricSummaryReport({
      allianceId: ALLIANCE_ID,
      metricId: METRIC_ID,
      periodId: PERIOD_ID,
      page: 99,
      pageSize: 25,
    });

    expect(report.pagination).toEqual({ page: 3, pageSize: 25, totalRowCount: 55 });
  });

  describe("comparison section", () => {
    function mockAttachedActiveSum() {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue(NUMERIC_METRIC as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
    }

    it("is null for a NONE-kind metric, and never queries comparison candidates", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue({
        ...NUMERIC_METRIC,
        summaryKind: MetricSummaryKind.NONE,
      } as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockCoreQueries({});

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.comparison).toBeNull();
      expect(prisma.metricPeriod.findMany).not.toHaveBeenCalled();
    });

    it("is NO_ELIGIBLE_PERIOD when there are no comparable candidates", async () => {
      mockAttachedActiveSum();
      mockCoreQueries({});
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.comparison).toEqual({ status: "NO_ELIGIBLE_PERIOD" });
    });

    it("is INVALID_COMPARISON_PERIOD when the requested comparePeriodId isn't eligible", async () => {
      mockAttachedActiveSum();
      mockCoreQueries({});
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        {
          id: "eligible-period",
          name: "Week 11",
          startsAt: new Date("2026-02-15"),
          endsAt: new Date("2026-02-28"),
          createdAt: new Date("2026-02-15"),
          periodMetrics: [{ active: true }],
        },
      ] as never);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
        comparePeriodId: "some-other-period",
      });

      expect(report.comparison).toEqual({
        status: "INVALID_COMPARISON_PERIOD",
        requestedPeriodId: "some-other-period",
        recommended: { id: "eligible-period", name: "Week 11" },
        eligiblePeriods: [{ id: "eligible-period", name: "Week 11" }],
      });
    });

    it("is NO_DATA_IN_COMPARISON_PERIOD when the selected period has data but the eligible comparison period has zero recorded entries", async () => {
      mockAttachedActiveSum();
      // The selected period must itself have data here, so this test
      // isolates "comparison period is empty" from "selected period is
      // empty" (see NO_DATA_IN_SELECTED_PERIOD below) — otherwise the new
      // selected-side gate would short-circuit before this branch ever runs.
      mockCoreQueries({ aggregateRow: zeroAggregateRow({ sum_value: BigInt(100), latest_entry_count: BigInt(1) }) });
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        {
          id: "eligible-period",
          name: "Week 11",
          startsAt: new Date("2026-02-15"),
          endsAt: new Date("2026-02-28"),
          createdAt: new Date("2026-02-15"),
          periodMetrics: [{ active: true }],
        },
      ] as never);
      // 5th $queryRaw call = the comparison period's aggregate (after the
      // selected period's aggregate, roster count, visualization rows, and
      // roster rows).
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([zeroAggregateRow()]);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.comparison).toEqual({
        status: "NO_DATA_IN_COMPARISON_PERIOD",
        period: { id: "eligible-period", name: "Week 11" },
        eligiblePeriods: [{ id: "eligible-period", name: "Week 11" }],
      });
    });

    it("is NO_DATA_IN_SELECTED_PERIOD (never a fabricated decline) when the selected period has no data but the eligible comparison period does", async () => {
      mockAttachedActiveSum();
      // Selected period aggregate is zero (the default) -> dataStatus NO_VALUES.
      mockCoreQueries({});
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        {
          id: "eligible-period",
          name: "Week 11",
          startsAt: new Date("2026-02-15"),
          endsAt: new Date("2026-02-28"),
          createdAt: new Date("2026-02-15"),
          periodMetrics: [{ active: true }],
        },
      ] as never);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.dataStatus).toBe("NO_VALUES");
      // Must never reach the comparison-period aggregate query, let alone
      // compute an absoluteChange/percentageChange against it. Exactly 4
      // calls: selected-period aggregate, roster count, visualization
      // rows, roster rows.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
      expect(report.comparison).toEqual({
        status: "NO_DATA_IN_SELECTED_PERIOD",
        period: { id: "eligible-period", name: "Week 11" },
        eligiblePeriods: [{ id: "eligible-period", name: "Week 11" }],
      });
    });

    it("is COMPARED with an independently-computed comparison rollup and the change vs. the selected period", async () => {
      mockAttachedActiveSum();
      mockCoreQueries({ aggregateRow: zeroAggregateRow({ sum_value: BigInt(150), latest_entry_count: BigInt(1) }) });
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        {
          id: "eligible-period",
          name: "Week 11",
          startsAt: new Date("2026-02-15"),
          endsAt: new Date("2026-02-28"),
          createdAt: new Date("2026-02-15"),
          periodMetrics: [{ active: true }],
        },
      ] as never);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        zeroAggregateRow({ sum_value: BigInt(100), latest_entry_count: BigInt(1) }),
      ]);

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.comparison).toEqual({
        status: "COMPARED",
        period: { id: "eligible-period", name: "Week 11" },
        eligiblePeriods: [{ id: "eligible-period", name: "Week 11" }],
        rollup: { kind: "SUM", total: 100, hasNegativeValues: false },
        absoluteChange: 50,
        percentageChange: 50,
      });
    });
  });
});
