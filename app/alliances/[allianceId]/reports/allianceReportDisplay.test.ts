import { describe, it, expect } from "vitest";
import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import type { MetricCoverage } from "@/app/src/lib/reports/getMetricSummaryReport";
import type { AllianceOverallCoverage } from "@/app/src/lib/reports/getAlliancePerformanceReport";
import {
  attachmentStatusBadge,
  formatCardCoverageSummary,
  formatCardComparisonSummary,
  formatOverallCoveragePercent,
  buildMetricCardBody,
} from "./allianceReportDisplay";

function coverage(overrides: Partial<MetricCoverage> = {}): MetricCoverage {
  return {
    currentActiveMemberCount: 10,
    recordedActiveMemberCount: 8,
    invalidActiveMemberCount: 0,
    missingActiveMemberCount: 2,
    complete: false,
    archivedContributingMemberCount: 0,
    ...overrides,
  };
}

describe("attachmentStatusBadge", () => {
  it("returns null for ACTIVE — no badge needed for the normal state", () => {
    expect(attachmentStatusBadge("ACTIVE")).toBeNull();
  });

  it("returns a warning badge for NOT_ATTACHED", () => {
    expect(attachmentStatusBadge("NOT_ATTACHED")).toEqual({ label: "Not attached", variant: "warning" });
  });

  it("returns a neutral badge for INACTIVE", () => {
    expect(attachmentStatusBadge("INACTIVE")).toEqual({ label: "Inactive attachment", variant: "neutral" });
  });
});

describe("formatCardCoverageSummary", () => {
  it("returns null when the metric isn't actively attached — no cells were possible to fill", () => {
    expect(formatCardCoverageSummary("NOT_ATTACHED", coverage())).toBeNull();
    expect(formatCardCoverageSummary("INACTIVE", coverage())).toBeNull();
  });

  it("returns null when there are no current active members at all", () => {
    expect(formatCardCoverageSummary("ACTIVE", coverage({ currentActiveMemberCount: 0 }))).toBeNull();
  });

  it("summarizes recorded vs. active member count when actively attached", () => {
    expect(formatCardCoverageSummary("ACTIVE", coverage())).toBe("8 of 10 active members recorded");
  });
});

describe("formatCardComparisonSummary", () => {
  it("returns null when there's no comparison at all", () => {
    expect(formatCardComparisonSummary(null, MetricSummaryKind.SUM, null)).toBeNull();
  });

  it("returns null for NO_ROLLUP (nothing to compare)", () => {
    expect(formatCardComparisonSummary({ status: "NO_ROLLUP" }, MetricSummaryKind.NONE, null)).toBeNull();
  });

  it("returns null for NO_DATA_IN_SELECTED_PERIOD — the card's own empty state already covers this", () => {
    expect(
      formatCardComparisonSummary({ status: "NO_DATA_IN_SELECTED_PERIOD" }, MetricSummaryKind.SUM, null),
    ).toBeNull();
  });

  it("describes NOT_ATTACHED against the comparison period", () => {
    expect(formatCardComparisonSummary({ status: "NOT_ATTACHED" }, MetricSummaryKind.SUM, null)).toBe(
      "Not attached in the comparison period",
    );
  });

  it("describes INACTIVE_ATTACHMENT against the comparison period", () => {
    expect(formatCardComparisonSummary({ status: "INACTIVE_ATTACHMENT" }, MetricSummaryKind.SUM, null)).toBe(
      "Inactive in the comparison period",
    );
  });

  it("describes NO_DATA_IN_COMPARISON_PERIOD", () => {
    expect(formatCardComparisonSummary({ status: "NO_DATA_IN_COMPARISON_PERIOD" }, MetricSummaryKind.SUM, null)).toBe(
      "No results recorded in the comparison period",
    );
  });

  it("formats a COMPARED SUM change via the shared rollup-change formatter", () => {
    const result = formatCardComparisonSummary(
      { status: "COMPARED", rollup: { kind: "SUM", total: 80, hasNegativeValues: false }, absoluteChange: 20, percentageChange: 25 },
      MetricSummaryKind.SUM,
      "pts",
    );
    expect(result).toBe("+20 pts (+25%)");
  });

  it("formats a COMPARED TRUE_RATE change as a point change", () => {
    const result = formatCardComparisonSummary(
      {
        status: "COMPARED",
        rollup: { kind: "TRUE_RATE", trueCount: 6, falseCount: 4, invalidCount: 0, trueRate: 60 },
        absoluteChange: 20,
        percentageChange: null,
      },
      MetricSummaryKind.TRUE_RATE,
      null,
    );
    expect(result).toBe("+20pp");
  });
});

describe("formatOverallCoveragePercent", () => {
  function overallCoverage(overrides: Partial<AllianceOverallCoverage> = {}): AllianceOverallCoverage {
    return {
      activeAttachmentCount: 0,
      notAttachedCount: 0,
      inactiveAttachmentCount: 0,
      expectedCells: 0,
      recordedCells: 0,
      coveragePercent: null,
      ...overrides,
    };
  }

  it("renders an em dash when there are no active attachments to measure", () => {
    expect(formatOverallCoveragePercent(overallCoverage())).toBe("—");
  });

  it("formats a resolved coverage percentage", () => {
    expect(formatOverallCoveragePercent(overallCoverage({ coveragePercent: 87.4 }))).toBe("87.4%");
  });
});

describe("buildMetricCardBody", () => {
  it("shows a not-attached message when there are no values and the metric was never attached", () => {
    expect(
      buildMetricCardBody({
        dataStatus: "NO_VALUES",
        attachmentStatus: "NOT_ATTACHED",
        rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
        unitLabel: null,
      }),
    ).toEqual({ kind: "NO_VALUES", text: "Not attached to this period" });
  });

  it("shows a historical-results message when there are no values and the attachment is inactive", () => {
    expect(
      buildMetricCardBody({
        dataStatus: "NO_VALUES",
        attachmentStatus: "INACTIVE",
        rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
        unitLabel: null,
      }),
    ).toEqual({ kind: "NO_VALUES", text: "No historical results" });
  });

  it("shows a generic no-results message when actively attached with no values", () => {
    expect(
      buildMetricCardBody({
        dataStatus: "NO_VALUES",
        attachmentStatus: "ACTIVE",
        rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
        unitLabel: null,
      }),
    ).toEqual({ kind: "NO_VALUES", text: "No results recorded yet" });
  });

  it("shows a no-rollup message for a NONE-kind metric even when it has values", () => {
    expect(
      buildMetricCardBody({
        dataStatus: "HAS_VALUES",
        attachmentStatus: "ACTIVE",
        rollup: { kind: "NONE" },
        unitLabel: null,
      }),
    ).toEqual({ kind: "NO_ROLLUP", text: "Reported per-member — no alliance-wide rollup" });
  });

  it("shows the formatted rollup headline when there are values and a configured rollup", () => {
    expect(
      buildMetricCardBody({
        dataStatus: "HAS_VALUES",
        attachmentStatus: "ACTIVE",
        rollup: { kind: "SUM", total: 1_500_000, hasNegativeValues: false },
        unitLabel: "pts",
      }),
    ).toEqual({ kind: "HEADLINE", text: "1.5M pts" });
  });
});
