import { describe, expect, it, vi } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { MIN_CELL_SIZE } from "./apsAuditPrivacy";
import { mapCoverageDistributionRow, runApsDataReadinessAudit } from "./apsDataReadinessAudit";
import type { AuditTxClient } from "./apsAuditTransaction";

/**
 * `mapCoverageDistributionRow` and the suppression/selection glue around it
 * are unit-tested here against fabricated raw rows. The SQL text itself
 * (the `DISTINCT ON`/`PERCENTILE_CONT`/cross-join query) is only verified
 * against real PostgreSQL, in `apsDataReadinessAudit.integration.test.ts`
 * -- a mocked `$queryRaw` can't prove a raw SQL string is even valid.
 */

type CoverageRow = {
  metric_id: string;
  current_active_member_count?: bigint;
  recorded_active_member_count?: bigint;
  invalid_active_member_count?: bigint;
  missing_active_member_count?: bigint;
  archived_contributing_member_count?: bigint;
  true_count?: bigint;
  false_count?: bigint;
  numeric_valid_count?: bigint;
  min_value?: number | null;
  max_value?: number | null;
  p25?: number | null;
  p50?: number | null;
  p75?: number | null;
  zero_count?: bigint;
  negative_count?: bigint;
  outlier_count?: bigint;
};

function coverageRow(overrides: Partial<CoverageRow> & { metric_id: string }): CoverageRow {
  return {
    current_active_member_count: BigInt(0),
    recorded_active_member_count: BigInt(0),
    invalid_active_member_count: BigInt(0),
    missing_active_member_count: BigInt(0),
    archived_contributing_member_count: BigInt(0),
    true_count: BigInt(0),
    false_count: BigInt(0),
    numeric_valid_count: BigInt(0),
    min_value: null,
    max_value: null,
    p25: null,
    p50: null,
    p75: null,
    zero_count: BigInt(0),
    negative_count: BigInt(0),
    outlier_count: BigInt(0),
    ...overrides,
  };
}

type MockData = {
  allianceIds: string[];
  metrics?: Record<string, unknown[]>;
  periods?: Record<string, unknown[]>;
  coverageRows?: CoverageRow[];
  periodsWithValidDataRows?: { metric_id: string; periods_with_valid_data_count: bigint }[];
};

function mockTx(data: MockData): AuditTxClient {
  return {
    alliance: {
      findMany: vi.fn().mockResolvedValue(data.allianceIds.map((id) => ({ id }))),
    },
    metric: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { allianceId: string } }) =>
          Promise.resolve(data.metrics?.[where.allianceId] ?? []),
        ),
    },
    metricPeriod: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { allianceId: string } }) =>
          Promise.resolve(data.periods?.[where.allianceId] ?? []),
        ),
    },
    // `tx.$queryRaw` is invoked as a tagged template for two distinct
    // queries in this module -- disambiguate on the query text itself,
    // the same way the two real queries differ.
    $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("periods_with_valid_data_count")) {
        return Promise.resolve(data.periodsWithValidDataRows ?? []);
      }
      return Promise.resolve(data.coverageRows ?? []);
    }),
  } as unknown as AuditTxClient;
}

describe("mapCoverageDistributionRow", () => {
  it("converts every bigint count column to a number", () => {
    const mapped = mapCoverageDistributionRow({
      metric_id: "m1",
      current_active_member_count: BigInt(10),
      recorded_active_member_count: BigInt(8),
      invalid_active_member_count: BigInt(1),
      missing_active_member_count: BigInt(1),
      archived_contributing_member_count: BigInt(2),
      true_count: BigInt(5),
      false_count: BigInt(3),
      numeric_valid_count: BigInt(0),
      min_value: null,
      max_value: null,
      p25: null,
      p50: null,
      p75: null,
      zero_count: BigInt(0),
      negative_count: BigInt(0),
      outlier_count: BigInt(0),
    });

    expect(mapped).toEqual({
      currentActiveMemberCount: 10,
      recordedActiveMemberCount: 8,
      invalidActiveMemberCount: 1,
      missingActiveMemberCount: 1,
      archivedContributingMemberCount: 2,
      trueCount: 5,
      falseCount: 3,
      numericValidCount: 0,
      minValue: null,
      maxValue: null,
      p25: null,
      p50: null,
      p75: null,
      zeroCount: 0,
      negativeCount: 0,
      outlierCount: 0,
    });
  });
});

describe("runApsDataReadinessAudit", () => {
  it("reports an alliance with no periods/metrics without throwing", async () => {
    const tx = mockTx({ allianceIds: ["alliance-1"] });
    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);

    expect(report.allianceCount).toBe(1);
    expect(report.alliances[0]!.label).toBe("Alliance A");
    expect(report.alliances[0]!.currentPeriodWeights).toEqual({ currentPeriodFound: false });
    expect(report.alliances[0]!.metricDistributions).toEqual([]);
    expect(report.alliances[0]!.dogfoodReadiness).toEqual({
      totalMetricCount: 0,
      metricsWithEnoughObservationsCount: 0,
      minPeriodsForDogfood: 3,
    });
  });

  it("counts metrics by type, summary kind, and trend direction", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
            active: true,
            periodMetrics: [],
          },
          {
            id: "m2",
            type: Metric_Type.BOOLEAN,
            summaryKind: MetricSummaryKind.TRUE_RATE,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: false,
            periodMetrics: [],
          },
        ],
      },
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const config = report.alliances[0]!.metricConfiguration;

    expect(config.totalMetricCount).toBe(2);
    expect(config.activeMetricCount).toBe(1);
    expect(config.archivedMetricCount).toBe(1);
    expect(config.byType[Metric_Type.NUMERIC]).toBe(1);
    expect(config.byType[Metric_Type.BOOLEAN]).toBe(1);
    expect(config.bySummaryKind[MetricSummaryKind.SUM]).toBe(1);
    expect(config.byTrendDirection[MetricTrendDirection.NEUTRAL]).toBe(1);
  });

  it("picks the most recently started active period as current", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      periods: {
        "alliance-1": [
          { id: "old", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08"), createdAt: new Date("2026-01-01"), active: true },
          { id: "new", startsAt: new Date("2026-02-01"), endsAt: new Date("2026-02-08"), createdAt: new Date("2026-02-01"), active: true },
          { id: "inactive-newest", startsAt: new Date("2026-03-01"), endsAt: new Date("2026-03-08"), createdAt: new Date("2026-03-01"), active: false },
        ],
      },
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [{ periodId: "new", weight: 7, required: true, active: true }],
          },
        ],
      },
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const weights = report.alliances[0]!.currentPeriodWeights;
    expect(weights).toEqual({
      currentPeriodFound: true,
      activeComponentCount: 1,
      zeroWeightComponentCount: 0,
      requiredComponentCount: 1,
      weightSum: 7,
    });
  });

  function activePeriodAndMetric() {
    return {
      periods: {
        "alliance-1": [
          { id: "p1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08"), createdAt: new Date("2026-01-01"), active: true },
        ],
      },
    };
  }

  it("wires DB-computed coverage counts through to the report, suppressing a small-cell distribution", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      ...activePeriodAndMetric(),
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      coverageRows: [
        coverageRow({
          metric_id: "m1",
          current_active_member_count: BigInt(10),
          recorded_active_member_count: BigInt(2),
          missing_active_member_count: BigInt(8),
          numeric_valid_count: BigInt(2),
          min_value: 10,
          max_value: 20,
          p25: 12.5,
          p50: 15,
          p75: 17.5,
        }),
      ],
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;

    // Active roster (10) is large enough that the coverage bundle itself
    // isn't suppressed...
    expect(row.coverage).toEqual({
      suppressed: false,
      value: { currentActiveMemberCount: 10, recordedActiveMemberCount: 2, invalidActiveMemberCount: 0, missingActiveMemberCount: 8 },
    });
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC") {
      // ...but only 2 valid values were ever recorded -- below MIN_CELL_SIZE,
      // so the distribution itself must still be suppressed independently.
      expect(row.section.distribution.suppressed).toBe(true);
    }
  });

  it("suppresses active-member coverage as a bundle when the active roster itself is a small cell", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      ...activePeriodAndMetric(),
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      coverageRows: [coverageRow({ metric_id: "m1", current_active_member_count: BigInt(3), recorded_active_member_count: BigInt(3) })],
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.coverage.suppressed).toBe(true);
  });

  it("suppresses archivedContributingMemberCount independently of coverage suppression", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      ...activePeriodAndMetric(),
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.BOOLEAN,
            summaryKind: MetricSummaryKind.TRUE_RATE,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      coverageRows: [
        coverageRow({
          metric_id: "m1",
          current_active_member_count: BigInt(20),
          recorded_active_member_count: BigInt(20),
          archived_contributing_member_count: BigInt(1),
          true_count: BigInt(15),
          false_count: BigInt(5),
        }),
      ],
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;
    // Large active roster -> coverage is NOT suppressed...
    expect(row.coverage.suppressed).toBe(false);
    // ...but only 1 archived contributor -> that count IS suppressed, even
    // though it rides along with an otherwise-unsuppressed row.
    expect(row.archivedContributingMemberCount.suppressed).toBe(true);
  });

  it("does not disclose invalid-boolean counts through the boolean section (they live only in coverage)", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      ...activePeriodAndMetric(),
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.BOOLEAN,
            summaryKind: MetricSummaryKind.TRUE_RATE,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      coverageRows: [
        coverageRow({
          metric_id: "m1",
          current_active_member_count: BigInt(20),
          recorded_active_member_count: BigInt(18),
          invalid_active_member_count: BigInt(2),
          true_count: BigInt(10),
          false_count: BigInt(8),
        }),
      ],
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.section.kind).toBe("BOOLEAN");
    if (row.section.kind === "BOOLEAN") {
      expect(row.section.counts).toEqual({ suppressed: false, value: { trueCount: 10, falseCount: 8 } });
      expect(JSON.stringify(row.section)).not.toContain("invalid");
    }
    expect(row.coverage).toEqual({
      suppressed: false,
      value: { currentActiveMemberCount: 20, recordedActiveMemberCount: 18, invalidActiveMemberCount: 2, missingActiveMemberCount: 0 },
    });
  });

  it("counts a metric as dogfood-ready only from DB-confirmed valid-data periods, not mere attachment", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      metrics: {
        "alliance-1": [
          {
            id: "attached-empty",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            // Attached to 3 periods, but the DB query (mocked below) says
            // zero of them ever got a valid entry -- must NOT count as ready.
            periodMetrics: [
              { periodId: "p1", weight: 1, required: false, active: true },
              { periodId: "p2", weight: 1, required: false, active: true },
              { periodId: "p3", weight: 1, required: false, active: true },
            ],
          },
          {
            id: "genuinely-ready",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [
              { periodId: "p1", weight: 1, required: false, active: true },
              { periodId: "p2", weight: 1, required: false, active: true },
              { periodId: "p3", weight: 1, required: false, active: true },
            ],
          },
        ],
      },
      periodsWithValidDataRows: [{ metric_id: "genuinely-ready", periods_with_valid_data_count: BigInt(3) }],
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    expect(report.alliances[0]!.dogfoodReadiness).toEqual({
      totalMetricCount: 2,
      metricsWithEnoughObservationsCount: 1,
      minPeriodsForDogfood: 3,
    });
  });

  it("never includes a metric or member name anywhere in the report", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [],
          },
        ],
      },
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/"name"/);
    expect(serialized).not.toMatch(/playerName/);
  });

  it(`does not suppress a distribution with at least MIN_CELL_SIZE (${MIN_CELL_SIZE}) contributing values`, async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      ...activePeriodAndMetric(),
      metrics: {
        "alliance-1": [
          {
            id: "m1",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            trendDirection: MetricTrendDirection.NEUTRAL,
            active: true,
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      coverageRows: [
        coverageRow({
          metric_id: "m1",
          current_active_member_count: BigInt(MIN_CELL_SIZE),
          recorded_active_member_count: BigInt(MIN_CELL_SIZE),
          numeric_valid_count: BigInt(MIN_CELL_SIZE),
          min_value: 0,
          max_value: MIN_CELL_SIZE - 1,
          p25: 1,
          p50: 2,
          p75: 3,
        }),
      ],
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC") {
      expect(row.section.distribution.suppressed).toBe(false);
    }
  });
});
