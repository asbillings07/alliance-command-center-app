import { describe, expect, it, vi } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { MIN_CELL_SIZE } from "./apsAuditPrivacy";
import { runApsDataReadinessAudit } from "./apsDataReadinessAudit";
import type { AuditTxClient } from "./apsAuditTransaction";

type MockData = {
  allianceIds: string[];
  metrics?: Record<string, unknown[]>;
  periods?: Record<string, unknown[]>;
  roster?: Record<string, unknown[]>;
  entriesByPeriod?: Record<string, unknown[]>;
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
    allianceMember: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { allianceId: string } }) =>
          Promise.resolve(data.roster?.[where.allianceId] ?? []),
        ),
    },
    memberMetricEntry: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { periodId: string } }) =>
          Promise.resolve(data.entriesByPeriod?.[where.periodId] ?? []),
        ),
    },
  } as unknown as AuditTxClient;
}

describe("runApsDataReadinessAudit", () => {
  it("reports an alliance with no periods/metrics/roster without throwing", async () => {
    const tx = mockTx({ allianceIds: ["alliance-1"] });
    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);

    expect(report.allianceCount).toBe(1);
    expect(report.alliances[0]!.label).toBe("Alliance A");
    expect(report.alliances[0]!.currentPeriodWeights).toEqual({ currentPeriodFound: false });
    expect(report.alliances[0]!.metricDistributions).toEqual([]);
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
          {
            id: "old",
            startsAt: new Date("2026-01-01"),
            endsAt: new Date("2026-01-08"),
            createdAt: new Date("2026-01-01"),
            active: true,
          },
          {
            id: "new",
            startsAt: new Date("2026-02-01"),
            endsAt: new Date("2026-02-08"),
            createdAt: new Date("2026-02-01"),
            active: true,
          },
          {
            id: "inactive-newest",
            startsAt: new Date("2026-03-01"),
            endsAt: new Date("2026-03-08"),
            createdAt: new Date("2026-03-01"),
            active: false,
          },
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

  it("classifies active-member coverage as recorded, invalid, or missing, and suppresses small-cell distributions", async () => {
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      periods: {
        "alliance-1": [
          {
            id: "p1",
            startsAt: new Date("2026-01-01"),
            endsAt: new Date("2026-01-08"),
            createdAt: new Date("2026-01-01"),
            active: true,
          },
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
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      roster: {
        "alliance-1": [
          { id: "member-1", archivedAt: null },
          { id: "member-2", archivedAt: null },
          { id: "member-3", archivedAt: null },
        ],
      },
      entriesByPeriod: {
        p1: [
          { allianceMemberId: "member-1", metricId: "m1", value: 10 },
          { allianceMemberId: "member-2", metricId: "m1", value: 20 },
          // member-3 has no entry -> missing.
        ],
      },
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;

    expect(row.currentActiveMemberCount).toBe(3);
    expect(row.recordedActiveMemberCount).toBe(2);
    expect(row.missingActiveMemberCount).toBe(1);
    expect(row.invalidActiveMemberCount).toBe(0);
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC") {
      // Only 2 valid values recorded -- below MIN_CELL_SIZE, so the
      // distribution itself must be suppressed rather than shown exactly.
      expect(row.section.distribution.suppressed).toBe(true);
    }
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

  it(`suppresses distributions with fewer than MIN_CELL_SIZE (${MIN_CELL_SIZE}) contributing values`, async () => {
    const values = Array.from({ length: MIN_CELL_SIZE }, (_, i) => ({
      allianceMemberId: `member-${i}`,
      metricId: "m1",
      value: i,
    }));
    const tx = mockTx({
      allianceIds: ["alliance-1"],
      periods: {
        "alliance-1": [
          {
            id: "p1",
            startsAt: new Date("2026-01-01"),
            endsAt: new Date("2026-01-08"),
            createdAt: new Date("2026-01-01"),
            active: true,
          },
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
            periodMetrics: [{ periodId: "p1", weight: 1, required: false, active: true }],
          },
        ],
      },
      roster: {
        "alliance-1": values.map((v) => ({ id: v.allianceMemberId, archivedAt: null })),
      },
      entriesByPeriod: { p1: values },
    });

    const report = await runApsDataReadinessAudit(tx, ["alliance-1"]);
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC") {
      expect(row.section.distribution.suppressed).toBe(false);
    }
  });
});
