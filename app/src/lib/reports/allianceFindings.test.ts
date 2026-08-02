import { describe, it, expect } from "vitest";
import { MetricSummaryKind, MetricTrendDirection, Metric_Type } from "@/app/generated/prisma/enums";
import { computeAllianceFindings } from "./allianceFindings";
import type { AllianceMetricPerformance, AllianceMetricComparison } from "./getAlliancePerformanceReport";
import type { MetricCoverage, MetricPeriodAttachmentStatus, MetricPeriodDataStatus } from "./getMetricSummaryReport";

function performance(overrides: Partial<AllianceMetricPerformance> = {}): AllianceMetricPerformance {
  return {
    metric: {
      id: "metric-1",
      name: "Donations",
      type: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.SUM,
      unitLabel: "pts",
      active: true,
      trendDirection: MetricTrendDirection.NEUTRAL,
    },
    attachmentStatus: "ACTIVE" as MetricPeriodAttachmentStatus,
    dataStatus: "HAS_VALUES" as MetricPeriodDataStatus,
    rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
    coverage: {
      currentActiveMemberCount: 10,
      recordedActiveMemberCount: 10,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 0,
      complete: true,
      archivedContributingMemberCount: 0,
    } satisfies MetricCoverage,
    comparison: null,
    ...overrides,
  };
}

function compared(overrides: Partial<Extract<AllianceMetricComparison, { status: "COMPARED" }>> = {}): AllianceMetricComparison {
  return {
    status: "COMPARED",
    rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
    absoluteChange: 0,
    percentageChange: 0,
    ...overrides,
  };
}

describe("computeAllianceFindings", () => {
  it("produces no findings for a fully healthy, fully covered, unchanged metric", () => {
    expect(computeAllianceFindings([performance({ comparison: compared({ absoluteChange: 0 }) })])).toEqual([]);
  });

  it("produces no findings for an archived metric, regardless of its state", () => {
    const archived = performance({
      metric: {
        id: "metric-archived",
        name: "Retired Metric",
        type: Metric_Type.NUMERIC,
        summaryKind: MetricSummaryKind.SUM,
        unitLabel: null,
        active: false,
        trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
      },
      attachmentStatus: "INACTIVE",
      dataStatus: "NO_VALUES",
      coverage: {
        currentActiveMemberCount: 10,
        recordedActiveMemberCount: 0,
        invalidActiveMemberCount: 3,
        missingActiveMemberCount: 10,
        complete: false,
        archivedContributingMemberCount: 0,
      },
      comparison: compared({ absoluteChange: -100 }),
    });

    expect(computeAllianceFindings([archived])).toEqual([]);
  });

  it("produces no findings for a NOT_ATTACHED metric", () => {
    const notAttached = performance({ attachmentStatus: "NOT_ATTACHED", dataStatus: "NO_VALUES" });
    expect(computeAllianceFindings([notAttached])).toEqual([]);
  });

  describe("INACTIVE_ATTACHMENT", () => {
    it("fires for an active metric whose attachment is inactive this period", () => {
      const findings = computeAllianceFindings([performance({ attachmentStatus: "INACTIVE" })]);
      expect(findings).toEqual([{ kind: "INACTIVE_ATTACHMENT", metricId: "metric-1", metricName: "Donations" }]);
    });

    it("is exclusive — no coverage/invalid/comparison findings, even if the underlying numbers would otherwise qualify", () => {
      const findings = computeAllianceFindings([
        performance({
          attachmentStatus: "INACTIVE",
          coverage: {
            currentActiveMemberCount: 10,
            recordedActiveMemberCount: 5,
            invalidActiveMemberCount: 2,
            missingActiveMemberCount: 5,
            complete: false,
            archivedContributingMemberCount: 0,
          },
          comparison: compared({ absoluteChange: -100 }),
          metric: {
            id: "metric-1",
            name: "Donations",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            unitLabel: "pts",
            active: true,
            trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
          },
        }),
      ]);
      expect(findings).toEqual([{ kind: "INACTIVE_ATTACHMENT", metricId: "metric-1", metricName: "Donations" }]);
    });
  });

  describe("MISSING_RESULTS", () => {
    it("fires for an active attachment with zero recorded values", () => {
      const findings = computeAllianceFindings([
        performance({
          dataStatus: "NO_VALUES",
          coverage: {
            currentActiveMemberCount: 10,
            recordedActiveMemberCount: 0,
            invalidActiveMemberCount: 0,
            missingActiveMemberCount: 10,
            complete: false,
            archivedContributingMemberCount: 0,
          },
        }),
      ]);
      expect(findings).toEqual([{ kind: "MISSING_RESULTS", metricId: "metric-1", metricName: "Donations" }]);
    });
  });

  describe("INVALID_VALUES", () => {
    it("fires with the invalid count when any active member's latest value is invalid", () => {
      const findings = computeAllianceFindings([
        performance({
          coverage: {
            currentActiveMemberCount: 10,
            recordedActiveMemberCount: 9,
            invalidActiveMemberCount: 1,
            missingActiveMemberCount: 0,
            complete: false,
            archivedContributingMemberCount: 0,
          },
        }),
      ]);
      expect(findings).toEqual([
        { kind: "INVALID_VALUES", metricId: "metric-1", metricName: "Donations", invalidCount: 1 },
      ]);
    });
  });

  describe("INCOMPLETE_COVERAGE", () => {
    it("fires with the missing/total counts when some active members haven't recorded a value", () => {
      const findings = computeAllianceFindings([
        performance({
          coverage: {
            currentActiveMemberCount: 10,
            recordedActiveMemberCount: 7,
            invalidActiveMemberCount: 0,
            missingActiveMemberCount: 3,
            complete: false,
            archivedContributingMemberCount: 0,
          },
        }),
      ]);
      expect(findings).toEqual([
        {
          kind: "INCOMPLETE_COVERAGE",
          metricId: "metric-1",
          metricName: "Donations",
          missingCount: 3,
          currentActiveMemberCount: 10,
        },
      ]);
    });

    it("can co-occur with INVALID_VALUES on the same metric, invalid first", () => {
      const findings = computeAllianceFindings([
        performance({
          coverage: {
            currentActiveMemberCount: 10,
            recordedActiveMemberCount: 6,
            invalidActiveMemberCount: 1,
            missingActiveMemberCount: 3,
            complete: false,
            archivedContributingMemberCount: 0,
          },
        }),
      ]);
      expect(findings.map((f) => f.kind)).toEqual(["INVALID_VALUES", "INCOMPLETE_COVERAGE"]);
    });
  });

  describe("ADVERSE_COMPARISON", () => {
    it("never fires for NEUTRAL trend direction, regardless of which way the metric moved", () => {
      const findings = computeAllianceFindings([
        performance({ comparison: compared({ absoluteChange: -500 }) }),
      ]);
      expect(findings).toEqual([]);
    });

    it("fires for HIGHER_IS_BETTER when the change is a decrease", () => {
      const findings = computeAllianceFindings([
        performance({
          metric: {
            id: "metric-1",
            name: "Donations",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            unitLabel: "pts",
            active: true,
            trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
          },
          comparison: compared({ absoluteChange: -50, percentageChange: -10 }),
        }),
      ]);
      expect(findings).toEqual([
        {
          kind: "ADVERSE_COMPARISON",
          metricId: "metric-1",
          metricName: "Donations",
          summaryKind: MetricSummaryKind.SUM,
          trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
          unitLabel: "pts",
          absoluteChange: -50,
          percentageChange: -10,
        },
      ]);
    });

    it("does not fire for HIGHER_IS_BETTER when the change is an increase or unchanged", () => {
      const higherIsBetter = {
        id: "metric-1",
        name: "Donations",
        type: Metric_Type.NUMERIC,
        summaryKind: MetricSummaryKind.SUM,
        unitLabel: "pts",
        active: true,
        trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
      } as const;

      expect(
        computeAllianceFindings([
          performance({ metric: higherIsBetter, comparison: compared({ absoluteChange: 50 }) }),
        ]),
      ).toEqual([]);
      expect(
        computeAllianceFindings([
          performance({ metric: higherIsBetter, comparison: compared({ absoluteChange: 0 }) }),
        ]),
      ).toEqual([]);
    });

    it("fires for LOWER_IS_BETTER when the change is an increase", () => {
      const findings = computeAllianceFindings([
        performance({
          metric: {
            id: "metric-1",
            name: "Response Time",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.AVERAGE,
            unitLabel: "hrs",
            active: true,
            trendDirection: MetricTrendDirection.LOWER_IS_BETTER,
          },
          comparison: compared({ absoluteChange: 2, percentageChange: 20 }),
        }),
      ]);
      expect(findings).toEqual([
        {
          kind: "ADVERSE_COMPARISON",
          metricId: "metric-1",
          metricName: "Response Time",
          summaryKind: MetricSummaryKind.AVERAGE,
          trendDirection: MetricTrendDirection.LOWER_IS_BETTER,
          unitLabel: "hrs",
          absoluteChange: 2,
          percentageChange: 20,
        },
      ]);
    });

    it("does not fire for LOWER_IS_BETTER when the change is a decrease or unchanged", () => {
      const lowerIsBetter = {
        id: "metric-1",
        name: "Response Time",
        type: Metric_Type.NUMERIC,
        summaryKind: MetricSummaryKind.AVERAGE,
        unitLabel: "hrs",
        active: true,
        trendDirection: MetricTrendDirection.LOWER_IS_BETTER,
      } as const;

      expect(
        computeAllianceFindings([
          performance({ metric: lowerIsBetter, comparison: compared({ absoluteChange: -2 }) }),
        ]),
      ).toEqual([]);
      expect(
        computeAllianceFindings([
          performance({ metric: lowerIsBetter, comparison: compared({ absoluteChange: 0 }) }),
        ]),
      ).toEqual([]);
    });

    it("never fires when there is no comparison at all (e.g. no comparable period resolved)", () => {
      const findings = computeAllianceFindings([
        performance({
          metric: {
            id: "metric-1",
            name: "Donations",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            unitLabel: "pts",
            active: true,
            trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
          },
          comparison: null,
        }),
      ]);
      expect(findings).toEqual([]);
    });

    it("never fires for a non-COMPARED comparison status (e.g. NOT_ATTACHED in the comparison period)", () => {
      const findings = computeAllianceFindings([
        performance({
          metric: {
            id: "metric-1",
            name: "Donations",
            type: Metric_Type.NUMERIC,
            summaryKind: MetricSummaryKind.SUM,
            unitLabel: "pts",
            active: true,
            trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
          },
          comparison: { status: "NOT_ATTACHED" },
        }),
      ]);
      expect(findings).toEqual([]);
    });

    it("is never assumed for TRUE_RATE (or any kind) without an explicit trendDirection", () => {
      const findings = computeAllianceFindings([
        performance({
          metric: {
            id: "metric-1",
            name: "Showed Up",
            type: Metric_Type.BOOLEAN,
            summaryKind: MetricSummaryKind.TRUE_RATE,
            unitLabel: null,
            active: true,
            trendDirection: MetricTrendDirection.NEUTRAL,
          },
          rollup: { kind: "TRUE_RATE", trueCount: 5, falseCount: 5, invalidCount: 0, trueRate: 50 },
          comparison: compared({
            rollup: { kind: "TRUE_RATE", trueCount: 3, falseCount: 7, invalidCount: 0, trueRate: 30 },
            absoluteChange: -20,
            percentageChange: null,
          }),
        }),
      ]);
      expect(findings).toEqual([]);
    });
  });

  it("preserves the input metric order and only flattens per-metric findings, without re-sorting by severity", () => {
    const healthy = performance({ metric: { ...performance().metric, id: "m1", name: "Healthy" } });
    const missing = performance({
      metric: { ...performance().metric, id: "m2", name: "Missing" },
      dataStatus: "NO_VALUES",
      coverage: {
        currentActiveMemberCount: 5,
        recordedActiveMemberCount: 0,
        invalidActiveMemberCount: 0,
        missingActiveMemberCount: 5,
        complete: false,
        archivedContributingMemberCount: 0,
      },
    });
    const inactive = performance({
      metric: { ...performance().metric, id: "m3", name: "Inactive" },
      attachmentStatus: "INACTIVE",
    });

    const findings = computeAllianceFindings([healthy, missing, inactive]);
    expect(findings.map((f) => f.metricId)).toEqual(["m2", "m3"]);
  });
});
