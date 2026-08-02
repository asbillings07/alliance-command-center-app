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

  describe("NOT_ATTACHED (selected period)", () => {
    it("fires for an active metric not attached to the selected period — 'intentional' and 'accidental' gaps are indistinguishable, so this surfaces rather than guesses", () => {
      const findings = computeAllianceFindings([
        performance({ attachmentStatus: "NOT_ATTACHED", dataStatus: "NO_VALUES" }),
      ]);
      expect(findings).toEqual([{ kind: "NOT_ATTACHED", metricId: "metric-1", metricName: "Donations" }]);
    });

    it("is exclusive — no coverage/invalid/comparison findings, even if present on the underlying object", () => {
      const findings = computeAllianceFindings([
        performance({
          attachmentStatus: "NOT_ATTACHED",
          dataStatus: "NO_VALUES",
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
      expect(findings).toEqual([{ kind: "NOT_ATTACHED", metricId: "metric-1", metricName: "Donations" }]);
    });
  });

  describe("archived metrics (metric.active === false)", () => {
    it("suppresses INACTIVE_ATTACHMENT — an archived metric isn't offered 'reactivate' guidance", () => {
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

    it("produces no findings for an archived, not-attached metric", () => {
      const archivedNotAttached = performance({
        metric: {
          id: "metric-archived-gone",
          name: "Fully Retired",
          type: Metric_Type.NUMERIC,
          summaryKind: MetricSummaryKind.SUM,
          unitLabel: null,
          active: false,
          trendDirection: MetricTrendDirection.NEUTRAL,
        },
        attachmentStatus: "NOT_ATTACHED",
        dataStatus: "NO_VALUES",
      });
      expect(computeAllianceFindings([archivedNotAttached])).toEqual([]);
    });

    it("still fires MISSING_RESULTS for an archived metric whose attachment remains ACTIVE with zero recorded values", () => {
      const archivedNoData = performance({
        metric: {
          id: "metric-archived-empty",
          name: "Live But Empty",
          type: Metric_Type.NUMERIC,
          summaryKind: MetricSummaryKind.SUM,
          unitLabel: null,
          active: false,
          trendDirection: MetricTrendDirection.NEUTRAL,
        },
        attachmentStatus: "ACTIVE",
        dataStatus: "NO_VALUES",
        coverage: {
          currentActiveMemberCount: 10,
          recordedActiveMemberCount: 0,
          invalidActiveMemberCount: 0,
          missingActiveMemberCount: 10,
          complete: false,
          archivedContributingMemberCount: 0,
        },
      });
      expect(computeAllianceFindings([archivedNoData])).toEqual([
        { kind: "MISSING_RESULTS", metricId: "metric-archived-empty", metricName: "Live But Empty" },
      ]);
    });

    it("still fires data-quality and comparison findings when an archived metric's attachment remains ACTIVE — archiving doesn't retroactively deactivate an already-active attachment", () => {
      const archivedButLive = performance({
        metric: {
          id: "metric-archived-live",
          name: "Still Live",
          type: Metric_Type.NUMERIC,
          summaryKind: MetricSummaryKind.SUM,
          unitLabel: "pts",
          active: false,
          trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
        },
        attachmentStatus: "ACTIVE",
        coverage: {
          currentActiveMemberCount: 10,
          recordedActiveMemberCount: 6,
          invalidActiveMemberCount: 1,
          missingActiveMemberCount: 3,
          complete: false,
          archivedContributingMemberCount: 0,
        },
        comparison: compared({ absoluteChange: -50 }),
      });

      const findings = computeAllianceFindings([archivedButLive]);
      expect(findings.map((f) => f.kind)).toEqual(["INVALID_VALUES", "INCOMPLETE_COVERAGE", "ADVERSE_COMPARISON"]);
    });
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

    it.each([["NOT_ATTACHED" as const], ["INACTIVE_ATTACHMENT" as const], ["NO_DATA_IN_COMPARISON_PERIOD" as const]])(
      "never fires for a non-COMPARED comparison status (%s) — that surfaces as COMPARISON_UNAVAILABLE instead (see that describe block), not ADVERSE_COMPARISON",
      (status) => {
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
            comparison: { status },
          }),
        ]);
        expect(findings.map((f) => f.kind)).not.toContain("ADVERSE_COMPARISON");
      },
    );

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

  describe("COMPARISON_UNAVAILABLE", () => {
    it.each([["NOT_ATTACHED" as const], ["INACTIVE_ATTACHMENT" as const], ["NO_DATA_IN_COMPARISON_PERIOD" as const]])(
      "fires with the underlying reason preserved when the comparison period's status is %s, even though a comparison period is in effect",
      (reason) => {
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
            comparison: { status: reason },
          }),
        ]);
        expect(findings).toEqual([
          { kind: "COMPARISON_UNAVAILABLE", metricId: "metric-1", metricName: "Donations", reason },
        ]);
      },
    );

    it.each([["NO_ROLLUP" as const], ["NO_DATA_IN_SELECTED_PERIOD" as const]])(
      "never fires for %s — NO_ROLLUP is a metric-config fact independent of the comparison period, and NO_DATA_IN_SELECTED_PERIOD is unreachable here (MISSING_RESULTS already returns first)",
      (status) => {
        const findings = computeAllianceFindings([performance({ comparison: { status } })]);
        expect(findings).toEqual([]);
      },
    );

    it("never fires when no comparison period is selected at all", () => {
      const findings = computeAllianceFindings([performance({ comparison: null })]);
      expect(findings).toEqual([]);
    });

    it("can co-occur with INVALID_VALUES and INCOMPLETE_COVERAGE on the same metric (the data-quality/comparison group)", () => {
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
          comparison: { status: "NOT_ATTACHED" },
        }),
      ]);
      expect(findings.map((f) => f.kind)).toEqual(["INVALID_VALUES", "INCOMPLETE_COVERAGE", "COMPARISON_UNAVAILABLE"]);
    });
  });

  describe("severity ordering across metrics", () => {
    it("orders metrics by their single most urgent finding kind across all 7 kinds, not the report's own metric order, keeping each metric's findings grouped", () => {
      // Deliberately listed in an order that doesn't match severity, to
      // prove the output is re-sorted rather than passed through.
      const comparisonUnavailable = performance({
        metric: { ...performance().metric, id: "m-cmp-unavailable", name: "Cmp Unavailable" },
        comparison: { status: "NOT_ATTACHED" },
      });
      const adverse = performance({
        metric: {
          ...performance().metric,
          id: "m-adverse",
          name: "Adverse",
          trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
        },
        comparison: compared({ absoluteChange: -50 }),
      });
      const notAttached = performance({
        metric: { ...performance().metric, id: "m-not-attached", name: "Not Attached" },
        attachmentStatus: "NOT_ATTACHED",
        dataStatus: "NO_VALUES",
      });
      const missing = performance({
        metric: { ...performance().metric, id: "m-missing", name: "Missing" },
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
        metric: { ...performance().metric, id: "m-inactive", name: "Inactive" },
        attachmentStatus: "INACTIVE",
      });
      // Has both INVALID_VALUES (priority 0) and INCOMPLETE_COVERAGE
      // (priority 2) — its worst (lowest-number) priority is 0, so it
      // should sort first, with both of its own findings kept adjacent.
      const dataQuality = performance({
        metric: { ...performance().metric, id: "m-dataquality", name: "Data Quality" },
        coverage: {
          currentActiveMemberCount: 10,
          recordedActiveMemberCount: 6,
          invalidActiveMemberCount: 1,
          missingActiveMemberCount: 3,
          complete: false,
          archivedContributingMemberCount: 0,
        },
      });

      const findings = computeAllianceFindings([
        comparisonUnavailable,
        adverse,
        notAttached,
        missing,
        inactive,
        dataQuality,
      ]);

      expect(findings.map((f) => `${f.metricId}:${f.kind}`)).toEqual([
        "m-dataquality:INVALID_VALUES",
        "m-dataquality:INCOMPLETE_COVERAGE",
        "m-missing:MISSING_RESULTS",
        "m-not-attached:NOT_ATTACHED",
        "m-inactive:INACTIVE_ATTACHMENT",
        "m-adverse:ADVERSE_COMPARISON",
        "m-cmp-unavailable:COMPARISON_UNAVAILABLE",
      ]);
    });

    it("keeps the report's own metric order for metrics tied on the same worst-priority finding kind", () => {
      const missingCoverage = {
        currentActiveMemberCount: 5,
        recordedActiveMemberCount: 0,
        invalidActiveMemberCount: 0,
        missingActiveMemberCount: 5,
        complete: false,
        archivedContributingMemberCount: 0,
      };
      const missingA = performance({
        metric: { ...performance().metric, id: "m-a", name: "A" },
        dataStatus: "NO_VALUES",
        coverage: missingCoverage,
      });
      const missingB = performance({
        metric: { ...performance().metric, id: "m-b", name: "B" },
        dataStatus: "NO_VALUES",
        coverage: missingCoverage,
      });

      const findings = computeAllianceFindings([missingB, missingA]);
      expect(findings.map((f) => f.metricId)).toEqual(["m-b", "m-a"]);
    });
  });
});
