import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metric: { findFirst: vi.fn() },
    metricPeriod: { findFirst: vi.fn(), findMany: vi.fn() },
    metricPeriodMetric: { findUnique: vi.fn() },
    allianceMember: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
// #287 Slice 3: queryAggregate/queryVisualizationRows source per-member
// values from the canonical read model instead of their own raw SQL now -
// mocked directly (matching getPeriodResultsSummary.test.ts's precedent)
// rather than reconstructing memberPeriodMetricValues' own internal SQL
// shape here, which is that module's own concern (see
// memberPeriodRollupAlgebra.integration.test.ts for its real behavior).
vi.mock("@/app/src/lib/metrics/memberPeriodMetricValues", () => ({
  memberPeriodMetricValues: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";
import type { MemberPeriodMetricValue } from "@/app/src/lib/metrics/memberPeriodMetricValues";
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

type FixtureMember = { id: string; playerName: string; archived?: boolean; value: number | null };

/** A `memberPeriodMetricValues` row for a legacy `PERIOD_VALUE + LATEST` metric - `value` *is* the raw latest-entry value, matching this test suite's pre-#287 fixtures exactly. */
function toRollupValue(member: FixtureMember, metricId = METRIC_ID): MemberPeriodMetricValue {
  return {
    metricId,
    allianceMemberId: member.id,
    value: member.value,
    observationCount: member.value === null ? 0 : 1,
    lastObservedOn: null,
    provenance: "Source period value",
  };
}

/**
 * Wires the roster (`prisma.allianceMember.findMany`) and the per-period
 * `memberPeriodMetricValues` fixture together, keyed by `periodId` so a
 * comparison-period test can give the selected and comparison periods
 * independent per-member values without depending on call order (both
 * `queryAggregate` and `queryVisualizationRows` call
 * `memberPeriodMetricValues` in parallel via `Promise.all`).
 */
function mockRosterAndValues(byPeriodId: Record<string, FixtureMember[]>) {
  const allMemberIds = new Set(Object.values(byPeriodId).flatMap((members) => members.map((m) => m.id)));
  const rosterById = new Map<string, FixtureMember>();
  for (const members of Object.values(byPeriodId)) {
    for (const member of members) rosterById.set(member.id, member);
  }
  vi.mocked(prisma.allianceMember.findMany).mockResolvedValue(
    [...allMemberIds].map((id) => {
      const member = rosterById.get(id)!;
      return { id: member.id, playerName: member.playerName, archivedAt: member.archived ? new Date() : null };
    }) as never,
  );
  vi.mocked(memberPeriodMetricValues).mockImplementation(async (_allianceId, periodId) => {
    const members = byPeriodId[periodId];
    if (!members) return [];
    return members.map((member) => toRollupValue(member));
  });
}

/**
 * Configures the standard call sequence for `countRosterRows`/
 * `queryRosterRows` — the only two calls still going straight to raw SQL
 * in this file (#287 Slice 3's `selected_values`-CTE-equivalent deferral;
 * see `docs/database-design/287-slice3-consumer-parity-log.md`).
 */
function mockRosterQuery(params: { totalRowCount?: number; rosterRows?: unknown[] }) {
  const { totalRowCount = 0, rosterRows = [] } = params;
  vi.mocked(prisma.$queryRaw)
    .mockResolvedValueOnce([{ total: BigInt(totalRowCount) }])
    .mockResolvedValueOnce(rosterRows);
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
    mockRosterAndValues({ [PERIOD_ID]: [] });
    mockRosterQuery({});

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
    mockRosterAndValues({ [PERIOD_ID]: [] });
    mockRosterQuery({});

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
    mockRosterAndValues({ [PERIOD_ID]: [{ id: "m1", playerName: "Alice", value: 10 }] });
    mockRosterQuery({});

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
    mockRosterAndValues({
      [PERIOD_ID]: [
        { id: "m1", playerName: "Alice", value: 150 },
        { id: "m2", playerName: "Bob", value: 50 },
      ],
    });
    mockRosterQuery({
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
      // The visualization query's cohort deliberately differs from the roster page below it —
      // this must drive the chart, not the (paginated, possibly filtered) roster rows. Both
      // queryAggregate and queryVisualizationRows read the *same* mocked roster/values here,
      // so the "sum=1000" aggregate and the "800+200" visualization cohort must agree.
      mockRosterAndValues({
        [PERIOD_ID]: [
          { id: "m1", playerName: "Alice", value: 800 },
          { id: "m2", playerName: "Bob", value: 200 },
        ],
      });
      mockRosterQuery({
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

      expect(report.rollup).toEqual({ kind: "SUM", total: 1000, hasNegativeValues: false });
      expect(report.visualModel).toMatchObject({
        kind: "SUM",
        consideredCount: 2,
        topContributors: [
          expect.objectContaining({ allianceMemberId: "m1", value: 800 }),
          expect.objectContaining({ allianceMemberId: "m2", value: 200 }),
        ],
      });
      expect(report.interpretationSummary).toBe(
        "VS Score totaled 1,000 pts; the top 2 members accounted for 100% of the total.",
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
      mockRosterAndValues({
        [PERIOD_ID]: [
          ...Array.from({ length: 14 }, (_, i) => ({ id: `true-${i}`, playerName: `T${i}`, value: 1 })),
          ...Array.from({ length: 4 }, (_, i) => ({ id: `false-${i}`, playerName: `F${i}`, value: 0 })),
          // Archived (not active) so this exercises "invalidCount includes
          // an archived contributor's out-of-range value" without also
          // touching invalidActiveMemberCount - matching the interpretation
          // summary's own "active members only" framing below.
          { id: "invalid-1", playerName: "Invalid", value: 5, archived: true },
          { id: "missing-1", playerName: "Missing", value: null },
          { id: "missing-2", playerName: "Missing2", value: null },
        ],
      });
      mockRosterQuery({});
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
        // 14 true + 4 false + 2 missing are active; the invalid one is archived.
        currentActiveMemberCount: 20,
      });
      expect(report.interpretationSummary).toBe(
        "14 of 18 valid responses were Yes; 2 active members have no recorded response.",
      );
      // TRUE_RATE's visual model is sourced entirely from `aggregate` - no
      // per-member visualization rows are derived for it (#264 PR4: an
      // unused array has no functional benefit). Regardless,
      // memberPeriodMetricValues is called exactly once - the aggregate's
      // own fetch (#287 Slice 3 perf fix: shared with visualization when
      // both are needed, so this count never varies by summary kind).
      expect(memberPeriodMetricValues).toHaveBeenCalledTimes(1);
      // $queryRaw called exactly twice: roster count, roster rows.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("skips the visualization query for a NONE+BOOLEAN metric too, sourcing its visual model from aggregate", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue({
        ...NUMERIC_METRIC,
        type: "BOOLEAN",
        summaryKind: MetricSummaryKind.NONE,
      } as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockRosterAndValues({
        [PERIOD_ID]: [
          ...Array.from({ length: 5 }, (_, i) => ({ id: `true-${i}`, playerName: `T${i}`, value: 1 })),
          ...Array.from({ length: 5 }, (_, i) => ({ id: `false-${i}`, playerName: `F${i}`, value: 0 })),
        ],
      });
      mockRosterQuery({});

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.visualModel).toMatchObject({ kind: "NONE", valueKind: "BOOLEAN", trueCount: 5, falseCount: 5 });
      expect(memberPeriodMetricValues).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("still runs the visualization query for a NONE+NUMERIC metric, which needs per-member values", async () => {
      vi.mocked(prisma.metric.findFirst).mockResolvedValue({
        ...NUMERIC_METRIC,
        summaryKind: MetricSummaryKind.NONE,
      } as never);
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
      vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
      mockRosterAndValues({
        [PERIOD_ID]: [
          { id: "m1", playerName: "Alice", value: 10 },
          { id: "m2", playerName: "Bob", value: 20 },
        ],
      });
      mockRosterQuery({});

      const report = await getMetricSummaryReport({
        allianceId: ALLIANCE_ID,
        metricId: METRIC_ID,
        periodId: PERIOD_ID,
      });

      expect(report.visualModel).toMatchObject({ kind: "NONE", valueKind: "NUMERIC", validCount: 2 });
      // #287 Slice 3 perf fix: the aggregate and the visualization rows
      // now share one fetch (fetchMemberPeriodValuesAndRoster) - exactly
      // one memberPeriodMetricValues call regardless of whether this
      // summary kind needs visualization rows derived from it.
      expect(memberPeriodMetricValues).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  it("clamps an out-of-range requested page down to the last real page before running the row query", async () => {
    vi.mocked(prisma.metric.findFirst).mockResolvedValue({
      ...NUMERIC_METRIC,
      summaryKind: MetricSummaryKind.NONE,
    } as never);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(SELECTED_PERIOD as never);
    vi.mocked(prisma.metricPeriodMetric.findUnique).mockResolvedValue({ active: true } as never);
    mockRosterAndValues({ [PERIOD_ID]: [] });
    // 55 total rows at page size 25 -> 3 pages; requesting page 99 must clamp to page 3.
    mockRosterQuery({ totalRowCount: 55, rosterRows: [] });

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
      mockRosterAndValues({ [PERIOD_ID]: [] });
      mockRosterQuery({});

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
      mockRosterAndValues({ [PERIOD_ID]: [] });
      mockRosterQuery({});
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
      mockRosterAndValues({ [PERIOD_ID]: [] });
      mockRosterQuery({});
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
      mockRosterAndValues({
        [PERIOD_ID]: [{ id: "m1", playerName: "Alice", value: 100 }],
        "eligible-period": [],
      });
      mockRosterQuery({});
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

      expect(report.comparison).toEqual({
        status: "NO_DATA_IN_COMPARISON_PERIOD",
        period: { id: "eligible-period", name: "Week 11" },
        eligiblePeriods: [{ id: "eligible-period", name: "Week 11" }],
      });
    });

    it("is NO_DATA_IN_SELECTED_PERIOD (never a fabricated decline) when the selected period has no data but the eligible comparison period does", async () => {
      mockAttachedActiveSum();
      // Selected period has no values -> dataStatus NO_VALUES. The
      // comparison period's own aggregate must never even be fetched.
      mockRosterAndValues({ [PERIOD_ID]: [] });
      mockRosterQuery({});
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
      // compute an absoluteChange/percentageChange against it.
      // memberPeriodMetricValues called exactly once: the selected period's
      // shared aggregate+visualization fetch (#287 Slice 3 perf fix) - never
      // the comparison period's.
      expect(memberPeriodMetricValues).toHaveBeenCalledTimes(1);
      expect(memberPeriodMetricValues).not.toHaveBeenCalledWith(ALLIANCE_ID, "eligible-period", expect.anything());
      expect(report.comparison).toEqual({
        status: "NO_DATA_IN_SELECTED_PERIOD",
        period: { id: "eligible-period", name: "Week 11" },
        eligiblePeriods: [{ id: "eligible-period", name: "Week 11" }],
      });
    });

    it("is COMPARED with an independently-computed comparison rollup and the change vs. the selected period", async () => {
      mockAttachedActiveSum();
      mockRosterAndValues({
        [PERIOD_ID]: [{ id: "m1", playerName: "Alice", value: 150 }],
        "eligible-period": [{ id: "m1", playerName: "Alice", value: 100 }],
      });
      mockRosterQuery({});
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
