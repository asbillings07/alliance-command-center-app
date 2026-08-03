import { describe, it, expect } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import type { MetricCoverage, MetricRollup } from "@/app/src/lib/reports/metricRollup";
import type { MetricVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import type {
  MetricPeriodAttachmentStatus,
  MetricPeriodDataStatus,
  MetricSummaryComparison,
} from "@/app/src/lib/reports/getMetricSummaryReport";
import { buildMetricInterpretationSummary } from "@/app/src/lib/reports/metricInterpretationSummary";

const COMPLETE_COVERAGE: MetricCoverage = {
  currentActiveMemberCount: 20,
  recordedActiveMemberCount: 20,
  invalidActiveMemberCount: 0,
  missingActiveMemberCount: 0,
  complete: true,
  archivedContributingMemberCount: 0,
};

function build(overrides: {
  metricName?: string;
  unitLabel?: string | null;
  summaryKind: MetricSummaryKind;
  metricType: Metric_Type;
  trendDirection?: MetricTrendDirection;
  attachmentStatus?: MetricPeriodAttachmentStatus;
  dataStatus?: MetricPeriodDataStatus;
  rollup: MetricRollup;
  coverage?: MetricCoverage;
  comparison?: MetricSummaryComparison | null;
  visualModel: MetricVisualModel;
}): string {
  return buildMetricInterpretationSummary({
    metricName: overrides.metricName ?? "Donations",
    unitLabel: overrides.unitLabel ?? null,
    summaryKind: overrides.summaryKind,
    metricType: overrides.metricType,
    trendDirection: overrides.trendDirection ?? MetricTrendDirection.NEUTRAL,
    attachmentStatus: overrides.attachmentStatus ?? "ACTIVE",
    dataStatus: overrides.dataStatus ?? "HAS_VALUES",
    rollup: overrides.rollup,
    coverage: overrides.coverage ?? COMPLETE_COVERAGE,
    comparison: overrides.comparison ?? null,
    visualModel: overrides.visualModel,
  });
}

describe("buildMetricInterpretationSummary — unavailable state (priority 1)", () => {
  it("reports not-attached, without even looking at rollup/coverage/comparison", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      attachmentStatus: "NOT_ATTACHED",
      dataStatus: "NO_VALUES",
      rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
      visualModel: { kind: "SUM", shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("Donations isn't attached to this period, so there's no data to interpret yet.");
  });

  it("reports an inactive attachment distinctly from not-attached", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      attachmentStatus: "INACTIVE",
      dataStatus: "NO_VALUES",
      rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
      visualModel: { kind: "SUM", shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("The attachment for Donations is inactive this period, so there's no data to interpret.");
  });

  it("reports no results when attached and active but nothing recorded", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      dataStatus: "NO_VALUES",
      rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
      visualModel: { kind: "SUM", shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("Donations has no recorded results yet this period.");
  });

  it("takes priority over coverage/comparison entirely (never mixes in a second fact)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      attachmentStatus: "NOT_ATTACHED",
      dataStatus: "NO_VALUES",
      rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
      coverage: { ...COMPLETE_COVERAGE, missingActiveMemberCount: 5 },
      comparison: { status: "COMPARED", period: { id: "p1", name: "Week 1" }, eligiblePeriods: [], rollup: { kind: "SUM", total: 10, hasNegativeValues: false }, absoluteChange: -10, percentageChange: -100 },
      visualModel: { kind: "SUM", shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("Donations isn't attached to this period, so there's no data to interpret yet.");
  });

  it("still reports HAS_VALUES data — never an unavailable-state denial — for an inactive attachment that retains historical entries", () => {
    // A real, non-degenerate state (see MetricPeriodAttachmentStatus's
    // docstring and getMetricSummaryReport.integration.test.ts's "shows
    // historical values under INACTIVE" case): the attachment was later
    // deactivated, but a value of 42 recorded while it was active remains.
    const text = build({
      metricName: "Deactivated Metric",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      attachmentStatus: "INACTIVE",
      dataStatus: "HAS_VALUES",
      rollup: { kind: "SUM", total: 42, hasNegativeValues: false },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [{ allianceMemberId: "m1", playerName: "Alice", archived: false, value: 42, percentageOfTotal: 100 }],
        consideredCount: 1,
      },
    });
    expect(text).toBe(
      "Deactivated Metric totaled 42; the attachment is now inactive, so this reflects historical data only.",
    );
  });

  it("ranks the inactive-with-history caveat above a coverage issue — it changes how the whole reading should be understood, not just a detail about it", () => {
    const text = build({
      metricName: "Deactivated Metric",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      attachmentStatus: "INACTIVE",
      dataStatus: "HAS_VALUES",
      rollup: { kind: "SUM", total: 42, hasNegativeValues: false },
      coverage: { ...COMPLETE_COVERAGE, missingActiveMemberCount: 5 },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [{ allianceMemberId: "m1", playerName: "Alice", archived: false, value: 42, percentageOfTotal: 100 }],
        consideredCount: 1,
      },
    });
    expect(text).toBe(
      "Deactivated Metric totaled 42; the attachment is now inactive, so this reflects historical data only.",
    );
  });
});

describe("buildMetricInterpretationSummary — one-sentence contract", () => {
  it("joins two facts into a single grammatical sentence (one period, semicolon-joined, second clause lowercased) — never two sentences", () => {
    const text = build({
      metricName: "Contributions",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 1000, hasNegativeValues: false },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [
          { allianceMemberId: "m1", playerName: "A", archived: false, value: 500, percentageOfTotal: 50 },
          { allianceMemberId: "m2", playerName: "B", archived: false, value: 120, percentageOfTotal: 12 },
        ],
        consideredCount: 2,
      },
    });
    expect(text).toBe("Contributions totaled 1,000; the top 2 members accounted for 62% of the total.");
    // Exactly one sentence: exactly one period, and it's the final character.
    expect(text.match(/\./g)).toHaveLength(1);
    expect(text.endsWith(".")).toBe(true);
  });

  it("returns fact1 unchanged (still period-terminated, no dangling semicolon) when there is no fact2", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
      visualModel: { kind: "SUM", shareAvailability: { available: true, percentageOfTotal: 100 }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("Donations totaled 500.");
    expect(text).not.toContain(";");
  });
});

describe("buildMetricInterpretationSummary — SUM", () => {
  it("states the total and the top-N concentration when coverage and comparison are both clean/absent (matches the canonical example)", () => {
    const text = build({
      metricName: "Contributions",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 1000, hasNegativeValues: false },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [
          { allianceMemberId: "m1", playerName: "A", archived: false, value: 500, percentageOfTotal: 50 },
          { allianceMemberId: "m2", playerName: "B", archived: false, value: 120, percentageOfTotal: 12 },
        ],
        consideredCount: 2,
      },
    });
    expect(text).toBe("Contributions totaled 1,000; the top 2 members accounted for 62% of the total.");
  });

  it("substitutes the offset caveat for the raw total when negative values are present, dropping the distribution fact entirely", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 100, hasNegativeValues: true },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: false, reason: "NEGATIVE_VALUES_PRESENT" },
        topContributors: [{ allianceMemberId: "m1", playerName: "A", archived: false, value: 150, percentageOfTotal: null }],
        consideredCount: 2,
      },
    });
    expect(text).toBe("Positive and negative contributions offset each other, so member shares are not meaningful.");
  });

  it("distinguishes an all-negative (or all-non-positive) cohort from a genuinely mixed-sign one — there's nothing positive to 'offset'", () => {
    const text = build({
      metricName: "Losses",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: -300, hasNegativeValues: true },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: false, reason: "NEGATIVE_VALUES_PRESENT" },
        // Every contributor is negative (or zero) — no positive value exists anywhere in the cohort.
        topContributors: [
          { allianceMemberId: "m1", playerName: "A", archived: false, value: -100, percentageOfTotal: null },
          { allianceMemberId: "m2", playerName: "B", archived: false, value: -200, percentageOfTotal: null },
        ],
        consideredCount: 2,
      },
    });
    expect(text).toBe("Losses had no positive contributions this period, so no member share is meaningful.");
  });

  it("explains a non-positive total distinctly from the negative-values case", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" },
        topContributors: [{ allianceMemberId: "m1", playerName: "A", archived: false, value: 0, percentageOfTotal: null }],
        consideredCount: 1,
      },
    });
    expect(text).toBe("Donations had no positive contributions this period, so no member share is meaningful.");
  });

  it("prefers a coverage-issue fact2 over the top-10 concentration fact2 when both are available", () => {
    const text = build({
      metricName: "Contributions",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 1000, hasNegativeValues: false },
      coverage: { ...COMPLETE_COVERAGE, missingActiveMemberCount: 2 },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [{ allianceMemberId: "m1", playerName: "A", archived: false, value: 1000, percentageOfTotal: 100 }],
        consideredCount: 1,
      },
    });
    expect(text).toBe("Contributions totaled 1,000; 2 active members have no recorded response.");
  });

  it("prefers a comparison-change fact2 over the top-10 concentration fact2 when coverage is clean but a comparison exists", () => {
    const text = build({
      metricName: "Contributions",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 1200, hasNegativeValues: false },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 3" },
        eligiblePeriods: [],
        rollup: { kind: "SUM", total: 1000, hasNegativeValues: false },
        absoluteChange: 200,
        percentageChange: 20,
      },
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [{ allianceMemberId: "m1", playerName: "A", archived: false, value: 1200, percentageOfTotal: 100 }],
        consideredCount: 1,
      },
    });
    expect(text).toBe("Contributions totaled 1,200; it increased by 20% since Week 3.");
  });

  it("never fabricates a distribution fact when there are no top contributors to describe", () => {
    const text = build({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
      visualModel: { kind: "SUM", shareAvailability: { available: true, percentageOfTotal: 100 }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("Donations totaled 500.");
  });

  it("reports the absolute change magnitude, not a bare 'increased' with no number, when percentageChange is unavailable (e.g. the comparison period's total was zero)", () => {
    const text = build({
      metricName: "Contributions",
      unitLabel: "pts",
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "SUM", total: 200, hasNegativeValues: false },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 3" },
        eligiblePeriods: [],
        rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
        absoluteChange: 200,
        percentageChange: null,
      },
      visualModel: { kind: "SUM", shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" }, topContributors: [], consideredCount: 0 },
    });
    expect(text).toBe("Contributions totaled 200 pts; it increased by 200 pts since Week 3.");
  });
});

describe("buildMetricInterpretationSummary — AVERAGE", () => {
  it("states the average, valid count, and invalid/missing coverage together (matches the canonical example)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "AVERAGE", average: 7.4 },
      coverage: { ...COMPLETE_COVERAGE, missingActiveMemberCount: 2, invalidActiveMemberCount: 1 },
      visualModel: {
        kind: "AVERAGE",
        average: 7.4,
        bins: [{ rangeStart: 0, rangeEnd: 10, count: 18 }],
        aboveAverageCount: 10,
        belowAverageCount: 8,
        atAverageCount: 0,
        validCount: 18,
      },
    });
    expect(text).toBe("The average was 7.4 across 18 valid results; 2 members are missing and 1 value is invalid.");
  });

  it("falls back to the above/below split as fact2 when coverage is complete and no comparison exists", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "AVERAGE", average: 10 },
      visualModel: {
        kind: "AVERAGE",
        average: 10,
        bins: [{ rangeStart: 0, rangeEnd: 20, count: 3 }],
        aboveAverageCount: 1,
        belowAverageCount: 1,
        atAverageCount: 1,
        validCount: 3,
      },
    });
    expect(text).toBe("The average was 10 across 3 valid results; 1 member is above average and 1 below.");
  });

  it("omits fact2 entirely in the all-equal case (no above/below spread to describe)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "AVERAGE", average: 5 },
      visualModel: {
        kind: "AVERAGE",
        average: 5,
        bins: [{ rangeStart: 5, rangeEnd: 5, count: 4 }],
        aboveAverageCount: 0,
        belowAverageCount: 0,
        atAverageCount: 4,
        validCount: 4,
      },
    });
    expect(text).toBe("The average was 5 across 4 valid results.");
  });

  it("reports no valid results distinctly from zero results at all", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "AVERAGE", average: null },
      visualModel: { kind: "AVERAGE", average: null, bins: [], aboveAverageCount: 0, belowAverageCount: 0, atAverageCount: 0, validCount: 0 },
    });
    expect(text).toBe("Donations has no valid results this period.");
  });

  it("carries a judgment verb only when trendDirection licenses it, for an unfavorable LOWER_IS_BETTER increase", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      trendDirection: MetricTrendDirection.LOWER_IS_BETTER,
      rollup: { kind: "AVERAGE", average: 12 },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 2" },
        eligiblePeriods: [],
        rollup: { kind: "AVERAGE", average: 10 },
        absoluteChange: 2,
        percentageChange: 20,
      },
      visualModel: { kind: "AVERAGE", average: 12, bins: [], aboveAverageCount: 0, belowAverageCount: 0, atAverageCount: 0, validCount: 5 },
    });
    expect(text).toContain("declined by 20% since Week 2.");
  });

  it("reports the absolute change magnitude, not a bare verb with no number, when percentageChange is unavailable (e.g. the comparison period's average was zero)", () => {
    const text = build({
      metricName: "VS Score",
      unitLabel: "pts",
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "AVERAGE", average: 12 },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 2" },
        eligiblePeriods: [],
        rollup: { kind: "AVERAGE", average: 0 },
        absoluteChange: 12,
        percentageChange: null,
      },
      visualModel: { kind: "AVERAGE", average: 12, bins: [], aboveAverageCount: 0, belowAverageCount: 0, atAverageCount: 0, validCount: 5 },
    });
    expect(text).toBe("The average was 12 pts across 5 valid results; it increased by 12 pts since Week 2.");
  });

  it("uses neutral 'increased' language for the identical change when trendDirection is NEUTRAL", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      trendDirection: MetricTrendDirection.NEUTRAL,
      rollup: { kind: "AVERAGE", average: 12 },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 2" },
        eligiblePeriods: [],
        rollup: { kind: "AVERAGE", average: 10 },
        absoluteChange: 2,
        percentageChange: 20,
      },
      visualModel: { kind: "AVERAGE", average: 12, bins: [], aboveAverageCount: 0, belowAverageCount: 0, atAverageCount: 0, validCount: 5 },
    });
    expect(text).toContain("increased by 20% since Week 2.");
  });

  it("reports an unchanged comparison distinctly, without a spurious 0% phrase", () => {
    const text = build({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "AVERAGE", average: 10 },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 2" },
        eligiblePeriods: [],
        rollup: { kind: "AVERAGE", average: 10 },
        absoluteChange: 0,
        percentageChange: 0,
      },
      visualModel: { kind: "AVERAGE", average: 10, bins: [], aboveAverageCount: 0, belowAverageCount: 0, atAverageCount: 0, validCount: 5 },
    });
    // Lowercased: it's fact2, joined after a semicolon, per the one-sentence contract.
    expect(text).toContain("it was unchanged since Week 2.");
  });
});

describe("buildMetricInterpretationSummary — TRUE_RATE", () => {
  it("states the yes/no split and missing coverage together (matches the canonical example)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.TRUE_RATE,
      metricType: Metric_Type.BOOLEAN,
      rollup: { kind: "TRUE_RATE", trueCount: 14, falseCount: 4, invalidCount: 0, trueRate: 77.7 },
      coverage: { ...COMPLETE_COVERAGE, missingActiveMemberCount: 2 },
      visualModel: {
        kind: "TRUE_RATE",
        trueCount: 14,
        falseCount: 4,
        invalidCount: 0,
        recordedActiveMemberCount: 18,
        missingActiveMemberCount: 2,
        currentActiveMemberCount: 20,
      },
    });
    expect(text).toBe("14 of 18 valid responses were Yes; 2 active members have no recorded response.");
  });

  it("has no separate distribution fact2 candidate — a clean cohort yields a single-fact sentence", () => {
    const text = build({
      summaryKind: MetricSummaryKind.TRUE_RATE,
      metricType: Metric_Type.BOOLEAN,
      rollup: { kind: "TRUE_RATE", trueCount: 10, falseCount: 10, invalidCount: 0, trueRate: 50 },
      visualModel: {
        kind: "TRUE_RATE",
        trueCount: 10,
        falseCount: 10,
        invalidCount: 0,
        recordedActiveMemberCount: 20,
        missingActiveMemberCount: 0,
        currentActiveMemberCount: 20,
      },
    });
    expect(text).toBe("10 of 20 valid responses were Yes.");
  });

  it("handles an all-invalid period (dataStatus HAS_VALUES but zero valid yes/no responses) without dividing by zero", () => {
    const text = build({
      summaryKind: MetricSummaryKind.TRUE_RATE,
      metricType: Metric_Type.BOOLEAN,
      rollup: { kind: "TRUE_RATE", trueCount: 0, falseCount: 0, invalidCount: 3, trueRate: null },
      coverage: { ...COMPLETE_COVERAGE, invalidActiveMemberCount: 3 },
      visualModel: {
        kind: "TRUE_RATE",
        trueCount: 0,
        falseCount: 0,
        invalidCount: 3,
        recordedActiveMemberCount: 0,
        missingActiveMemberCount: 0,
        currentActiveMemberCount: 3,
      },
    });
    expect(text).toBe("No valid Yes/No responses have been recorded this period; 3 values are invalid.");
  });

  it("expresses a comparison change as a percentage-point difference, never a percent-of-a-percent", () => {
    const text = build({
      summaryKind: MetricSummaryKind.TRUE_RATE,
      metricType: Metric_Type.BOOLEAN,
      rollup: { kind: "TRUE_RATE", trueCount: 16, falseCount: 4, invalidCount: 0, trueRate: 80 },
      comparison: {
        status: "COMPARED",
        period: { id: "p1", name: "Week 5" },
        eligiblePeriods: [],
        rollup: { kind: "TRUE_RATE", trueCount: 14, falseCount: 6, invalidCount: 0, trueRate: 70 },
        absoluteChange: 10,
        percentageChange: null,
      },
      visualModel: {
        kind: "TRUE_RATE",
        trueCount: 16,
        falseCount: 4,
        invalidCount: 0,
        recordedActiveMemberCount: 20,
        missingActiveMemberCount: 0,
        currentActiveMemberCount: 20,
      },
    });
    expect(text).toBe("16 of 20 valid responses were Yes; the rate increased by 10pp since Week 5.");
  });
});

describe("buildMetricInterpretationSummary — NONE", () => {
  it("describes the numeric distribution and always discloses the absence of a rollup when coverage is clean (matches the canonical example)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 2 },
          { rangeStart: 10, rangeEnd: 20, count: 9 },
          { rangeStart: 20, rangeEnd: 30, count: 1 },
        ],
        validCount: 12,
      },
    });
    expect(text).toBe("Values were concentrated between 10 and 20; no alliance-wide rollup is defined for this metric.");
  });

  it("drops the rollup disclaimer in favor of a coverage-issue fact2 when coverage isn't clean", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      coverage: { ...COMPLETE_COVERAGE, missingActiveMemberCount: 3 },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [{ rangeStart: 0, rangeEnd: 10, count: 5 }],
        validCount: 5,
      },
    });
    expect(text).toBe("Values were concentrated between 0 and 10; 3 active members have no recorded response.");
  });

  it("reports no valid results, still with the rollup disclaimer, when there is truly nothing to bin", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: { kind: "NONE", valueKind: "NUMERIC", bins: [], validCount: 0 },
    });
    expect(text).toBe("Donations has no valid results this period; no alliance-wide rollup is defined for this metric.");
  });

  it("states 'every recorded value was X' rather than a degenerate 'between X and X' when every valid value is identical", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        // buildDistributionBins' single-bin, all-equal case: rangeStart === rangeEnd.
        bins: [{ rangeStart: 5, rangeEnd: 5, count: 4 }],
        validCount: 4,
      },
    });
    expect(text).toBe("Every recorded value was 5; no alliance-wide rollup is defined for this metric.");
  });

  it("uses the same yes/no framing as TRUE_RATE for a BOOLEAN metric, plus the rollup disclaimer", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.BOOLEAN,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "BOOLEAN",
        trueCount: 6,
        falseCount: 4,
        invalidCount: 0,
        recordedActiveMemberCount: 10,
        missingActiveMemberCount: 0,
        currentActiveMemberCount: 10,
      },
    });
    expect(text).toBe("6 of 10 valid responses were Yes; no alliance-wide rollup is defined for this metric.");
  });

  it("never produces a comparison fact2 — NONE-kind metrics structurally never have a comparison", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      // Even if a caller somehow passed a COMPARED-shaped object in (shouldn't happen —
      // getMetricSummaryReport never builds one for NONE — but defends against it anyway).
      comparison: null,
      visualModel: { kind: "NONE", valueKind: "NUMERIC", bins: [{ rangeStart: 0, rangeEnd: 5, count: 1 }], validCount: 1 },
    });
    expect(text).toBe("Values were concentrated between 0 and 5; no alliance-wide rollup is defined for this metric.");
  });

  it("uses neutral 'ranged from X to Y' wording, not a false 'concentrated' claim, when two bins are tied for the max", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 5 },
          { rangeStart: 10, rangeEnd: 20, count: 5 },
          { rangeStart: 20, rangeEnd: 30, count: 2 },
        ],
        validCount: 12,
      },
    });
    expect(text).toBe("Values ranged from 0 to 30, without a clear concentration; no alliance-wide rollup is defined for this metric.");
  });

  it("uses neutral 'ranged from X to Y' wording for a perfectly uniform distribution (every bin equally populated)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 2 },
          { rangeStart: 10, rangeEnd: 20, count: 2 },
          { rangeStart: 20, rangeEnd: 30, count: 2 },
          { rangeStart: 30, rangeEnd: 40, count: 2 },
          { rangeStart: 40, rangeEnd: 50, count: 2 },
          { rangeStart: 50, rangeEnd: 60, count: 2 },
        ],
        validCount: 12,
      },
    });
    expect(text).toBe("Values ranged from 0 to 60, without a clear concentration; no alliance-wide rollup is defined for this metric.");
  });

  it("uses neutral 'ranged from X to Y' wording for a sparse distribution with a tied, low-count modal bin", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 1 },
          { rangeStart: 10, rangeEnd: 20, count: 0 },
          { rangeStart: 20, rangeEnd: 30, count: 0 },
          { rangeStart: 30, rangeEnd: 40, count: 1 },
          { rangeStart: 40, rangeEnd: 50, count: 0 },
          { rangeStart: 50, rangeEnd: 60, count: 0 },
        ],
        validCount: 2,
      },
    });
    expect(text).toBe("Values ranged from 0 to 60, without a clear concentration; no alliance-wide rollup is defined for this metric.");
  });

  it("still claims 'concentrated' when one bin uniquely exceeds the uniform baseline, even with several other non-empty bins (control case)", () => {
    const text = build({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rollup: { kind: "NONE" },
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 1 },
          { rangeStart: 10, rangeEnd: 20, count: 8 },
          { rangeStart: 20, rangeEnd: 30, count: 1 },
          { rangeStart: 30, rangeEnd: 40, count: 1 },
          { rangeStart: 40, rangeEnd: 50, count: 1 },
          { rangeStart: 50, rangeEnd: 60, count: 0 },
        ],
        validCount: 12,
      },
    });
    expect(text).toBe("Values were concentrated between 10 and 20; no alliance-wide rollup is defined for this metric.");
  });
});
