import { describe, it, expect } from "vitest";
import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import type { AggregateSnapshot, MetricCoverage, MetricRollup } from "./getMetricSummaryReport";
import { buildAllianceMetricComparison, computeOverallCoverage, zeroAggregateSnapshot } from "./getAlliancePerformanceReport";

function aggregate(overrides: Partial<AggregateSnapshot> = {}): AggregateSnapshot {
  return { ...zeroAggregateSnapshot(), ...overrides };
}

describe("zeroAggregateSnapshot", () => {
  it("is all-zero/null, matching an empty cohort", () => {
    expect(zeroAggregateSnapshot()).toEqual({
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
    });
  });
});

describe("buildAllianceMetricComparison", () => {
  const sumRollup: MetricRollup = { kind: "SUM", total: 100, hasNegativeValues: false };

  it("returns NO_ROLLUP for a NONE-kind metric regardless of attachment/data state", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.NONE,
      selectedDataStatus: "HAS_VALUES",
      selectedRollup: { kind: "NONE" },
      comparisonAttachmentStatus: "ACTIVE",
      comparisonAggregate: aggregate({ latestEntryCount: 5 }),
    });
    expect(result).toEqual({ status: "NO_ROLLUP" });
  });

  it("returns NO_DATA_IN_SELECTED_PERIOD when the selected period has no values, even if the comparison period does", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.SUM,
      selectedDataStatus: "NO_VALUES",
      selectedRollup: { kind: "SUM", total: 0, hasNegativeValues: false },
      comparisonAttachmentStatus: "ACTIVE",
      comparisonAggregate: aggregate({ latestEntryCount: 5, sumValue: 80 }),
    });
    expect(result).toEqual({ status: "NO_DATA_IN_SELECTED_PERIOD" });
  });

  it("returns NOT_ATTACHED when the metric was never attached to the shared comparison period", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.SUM,
      selectedDataStatus: "HAS_VALUES",
      selectedRollup: sumRollup,
      comparisonAttachmentStatus: "NOT_ATTACHED",
      comparisonAggregate: zeroAggregateSnapshot(),
    });
    expect(result).toEqual({ status: "NOT_ATTACHED" });
  });

  it("returns INACTIVE_ATTACHMENT when the metric's attachment on the comparison period is inactive", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.SUM,
      selectedDataStatus: "HAS_VALUES",
      selectedRollup: sumRollup,
      comparisonAttachmentStatus: "INACTIVE",
      comparisonAggregate: aggregate({ latestEntryCount: 5, sumValue: 80 }),
    });
    expect(result).toEqual({ status: "INACTIVE_ATTACHMENT" });
  });

  it("returns NO_DATA_IN_COMPARISON_PERIOD when the attachment is active but nothing was recorded there", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.SUM,
      selectedDataStatus: "HAS_VALUES",
      selectedRollup: sumRollup,
      comparisonAttachmentStatus: "ACTIVE",
      comparisonAggregate: zeroAggregateSnapshot(),
    });
    expect(result).toEqual({ status: "NO_DATA_IN_COMPARISON_PERIOD" });
  });

  it("computes a COMPARED result with rollup and change when both periods have data", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.SUM,
      selectedDataStatus: "HAS_VALUES",
      selectedRollup: sumRollup, // total 100
      comparisonAttachmentStatus: "ACTIVE",
      comparisonAggregate: aggregate({ latestEntryCount: 3, sumValue: 80 }),
    });
    expect(result).toEqual({
      status: "COMPARED",
      rollup: { kind: "SUM", total: 80, hasNegativeValues: false },
      absoluteChange: 20,
      percentageChange: 25,
    });
  });

  it("computes a COMPARED TRUE_RATE result with a null percentageChange (point change only)", () => {
    const result = buildAllianceMetricComparison({
      summaryKind: MetricSummaryKind.TRUE_RATE,
      selectedDataStatus: "HAS_VALUES",
      selectedRollup: { kind: "TRUE_RATE", trueCount: 8, falseCount: 2, invalidCount: 0, trueRate: 80 },
      comparisonAttachmentStatus: "ACTIVE",
      comparisonAggregate: aggregate({ latestEntryCount: 10, trueCount: 6, falseCount: 4 }),
    });
    expect(result.status).toBe("COMPARED");
    if (result.status !== "COMPARED") throw new Error("unreachable");
    expect(result.rollup).toEqual({ kind: "TRUE_RATE", trueCount: 6, falseCount: 4, invalidCount: 0, trueRate: 60 });
    expect(result.absoluteChange).toBe(20);
    expect(result.percentageChange).toBeNull();
  });
});

describe("computeOverallCoverage", () => {
  function coverage(overrides: Partial<MetricCoverage> = {}): MetricCoverage {
    return {
      currentActiveMemberCount: 0,
      recordedActiveMemberCount: 0,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 0,
      complete: true,
      archivedContributingMemberCount: 0,
      ...overrides,
    };
  }

  it("returns a null coveragePercent and zero cell counts when there are no active attachments", () => {
    const result = computeOverallCoverage([
      { attachmentStatus: "NOT_ATTACHED", coverage: coverage() },
      { attachmentStatus: "INACTIVE", coverage: coverage() },
    ]);
    expect(result).toEqual({
      activeAttachmentCount: 0,
      notAttachedCount: 1,
      inactiveAttachmentCount: 1,
      expectedCells: 0,
      recordedCells: 0,
      coveragePercent: null,
    });
  });

  it("sums expected/recorded cells only across active-attachment metrics", () => {
    const result = computeOverallCoverage([
      {
        attachmentStatus: "ACTIVE",
        coverage: coverage({ currentActiveMemberCount: 10, recordedActiveMemberCount: 8 }),
      },
      {
        attachmentStatus: "ACTIVE",
        coverage: coverage({ currentActiveMemberCount: 10, recordedActiveMemberCount: 10 }),
      },
      {
        // Not attached: contributes to notAttachedCount only, never to expected/recorded cells,
        // even though its own coverage object (if any) might otherwise look "complete."
        attachmentStatus: "NOT_ATTACHED",
        coverage: coverage({ currentActiveMemberCount: 10, recordedActiveMemberCount: 0 }),
      },
    ]);
    expect(result).toEqual({
      activeAttachmentCount: 2,
      notAttachedCount: 1,
      inactiveAttachmentCount: 0,
      expectedCells: 20,
      recordedCells: 18,
      coveragePercent: 90,
    });
  });
});
