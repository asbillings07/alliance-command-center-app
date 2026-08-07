import { describe, expect, it } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { MIN_CELL_SIZE, suppressCorrelatedCounts } from "./apsAuditPrivacy";
import { formatApsDataReadinessAuditReport } from "./apsAuditReportFormat";
import type {
  AllianceAuditSection,
  ApsDataReadinessAuditReport,
  BooleanMetricDistributionSection,
  MetricCoverageStats,
  NumericMetricDistributionSection,
} from "./apsDataReadinessAudit";

/**
 * Final-output regressions (#284 PR A review): everything above this module
 * assembles an in-memory report; these tests check the actual printed
 * string -- the only thing that ever reaches stdout -- for both member-level
 * suppression and alliance-configuration coarsening, at exactly the small
 * (1-4) sample sizes the review flagged as previously unprotected, AND for
 * the closed-sum bundles where a small member must not be recoverable by
 * subtracting the other (otherwise-exact) members of its own group.
 */

const SUPPRESSED = `suppressed (cell size < ${MIN_CELL_SIZE})`;
const EMPTY_DURATION_BUCKETS = { LTE_7_DAYS: 0, D8_TO_14_DAYS: 0, D15_TO_31_DAYS: 0, D32_PLUS_DAYS: 0 };

function baseSection(overrides: Partial<AllianceAuditSection> = {}): AllianceAuditSection {
  return {
    label: "Alliance A",
    comparablePeriods: {
      periodCount: 0,
      periodsWithBothDatesCount: 0,
      comparablePairCount: 0,
      durationBucketCounts: { ...EMPTY_DURATION_BUCKETS },
    },
    metricConfiguration: {
      totalMetricCount: 0,
      activeMetricCount: 0,
      archivedMetricCount: 0,
      byType: { [Metric_Type.NUMERIC]: 0, [Metric_Type.BOOLEAN]: 0 },
      bySummaryKind: Object.fromEntries(Object.values(MetricSummaryKind).map((k) => [k, 0])) as Record<
        MetricSummaryKind,
        number
      >,
      byTrendDirection: Object.fromEntries(Object.values(MetricTrendDirection).map((k) => [k, 0])) as Record<
        MetricTrendDirection,
        number
      >,
      activeAttachmentCount: 0,
      inactiveAttachmentCount: 0,
    },
    currentPeriodWeights: { currentPeriodFound: false },
    metricDistributions: [],
    metricStability: { consecutivePeriodPairCount: 0, metricsAddedCount: 0, metricsRemovedCount: 0, weightChangedCount: 0 },
    dogfoodReadiness: { totalMetricCount: 0, metricsWithEnoughObservationsCount: 0, minPeriodsForDogfood: 3 },
    ...overrides,
  };
}

function baseReport(alliances: AllianceAuditSection[]): ApsDataReadinessAuditReport {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    allianceCount: alliances.length,
    minCellSize: MIN_CELL_SIZE,
    minPeriodsForDogfood: 3,
    alliances,
    limitations: ["Test limitation."],
  };
}

describe("formatApsDataReadinessAuditReport", () => {
  it("renders a suppressed metric row without leaking any underlying number", () => {
    const section = baseSection({
      metricDistributions: [
        {
          metricLabel: "Metric 1",
          summaryKind: MetricSummaryKind.SUM,
          trendDirection: MetricTrendDirection.NEUTRAL,
          stats: { suppressed: true, cellSize: 1, minCellSize: MIN_CELL_SIZE },
        },
      ],
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));

    expect(output).toContain(SUPPRESSED);
    // The exact suppressed cellSize (1) must never appear anywhere in the printed report.
    expect(output).not.toMatch(/cell size 1/);
  });

  it("renders an unsuppressed metric row's exact numbers", () => {
    const section = baseSection({
      metricDistributions: [
        {
          metricLabel: "Metric 1",
          summaryKind: MetricSummaryKind.SUM,
          trendDirection: MetricTrendDirection.NEUTRAL,
          stats: {
            suppressed: false,
            value: {
              coverage: { currentActiveMemberCount: 20, recordedActiveMemberCount: 20, invalidActiveMemberCount: 0, missingActiveMemberCount: 0 },
              archivedContributingMemberCount: 0,
              section: {
                kind: "NUMERIC",
                distribution: { count: 20, min: 1, max: 10, p25: 3, p50: 5, p75: 8, zeroCount: 0, negativeCount: 0, outlierCount: 0 },
              },
            },
          },
        },
      ],
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain("active 20/20 recorded");
    expect(output).toContain("count=20 min=1 max=10");
  });

  // ---------------------------------------------------------------------
  // End-to-end: raw counts run through the REAL suppressCorrelatedCounts
  // primitive (not a hand-constructed already-suppressed stat), then
  // through the formatter -- proving the actual pipeline, not just the
  // formatter's handling of a pre-suppressed shape.
  // ---------------------------------------------------------------------

  it("end-to-end: 5 active + 1 archived contributor is suppressed via the real suppressCorrelatedCounts pipeline, and the final text reveals neither the archived count nor the exact split", () => {
    const coverage: MetricCoverageStats = {
      currentActiveMemberCount: 5,
      recordedActiveMemberCount: 5,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 0,
    };
    const archivedContributingMemberCount = 1; // small, positive -> risky
    const section: NumericMetricDistributionSection = {
      kind: "NUMERIC",
      distribution: { count: 6, min: 1, max: 10, p25: 2, p50: 5, p75: 8, zeroCount: 0, negativeCount: 0, outlierCount: 0 },
    };
    const totalValidCount = 6;
    const stats = suppressCorrelatedCounts(
      [
        coverage.currentActiveMemberCount,
        coverage.recordedActiveMemberCount,
        coverage.invalidActiveMemberCount,
        coverage.missingActiveMemberCount,
        archivedContributingMemberCount,
        totalValidCount,
        section.distribution!.zeroCount,
        section.distribution!.negativeCount,
        section.distribution!.outlierCount,
      ],
      { coverage, archivedContributingMemberCount, section },
    );

    const allianceSection = baseSection({
      metricDistributions: [{ metricLabel: "Metric 1", summaryKind: MetricSummaryKind.SUM, trendDirection: MetricTrendDirection.NEUTRAL, stats }],
    });
    const output = formatApsDataReadinessAuditReport(baseReport([allianceSection]));

    expect(output).toContain(SUPPRESSED);
    expect(output).not.toContain("archived contributors: 1");
    expect(output).not.toContain("count=6");
  });

  it("end-to-end: 9 normal + 1 outlier numeric value is suppressed via the real suppressCorrelatedCounts pipeline, and the final text never shows the exact distribution", () => {
    const coverage: MetricCoverageStats = {
      currentActiveMemberCount: 10,
      recordedActiveMemberCount: 10,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 0,
    };
    const section: NumericMetricDistributionSection = {
      kind: "NUMERIC",
      distribution: { count: 10, min: 1, max: 500, p25: 3, p50: 5, p75: 8, zeroCount: 0, negativeCount: 0, outlierCount: 1 },
    };
    const stats = suppressCorrelatedCounts(
      [
        coverage.currentActiveMemberCount,
        coverage.recordedActiveMemberCount,
        coverage.invalidActiveMemberCount,
        coverage.missingActiveMemberCount,
        0,
        section.distribution!.count,
        section.distribution!.zeroCount,
        section.distribution!.negativeCount,
        section.distribution!.outlierCount,
      ],
      { coverage, archivedContributingMemberCount: 0, section },
    );

    const allianceSection = baseSection({
      metricDistributions: [{ metricLabel: "Metric 1", summaryKind: MetricSummaryKind.SUM, trendDirection: MetricTrendDirection.NEUTRAL, stats }],
    });
    const output = formatApsDataReadinessAuditReport(baseReport([allianceSection]));

    expect(output).toContain(SUPPRESSED);
    expect(output).not.toContain("max=500");
    expect(output).not.toContain("outliers=1");
  });

  it("end-to-end: a 9/1 boolean split is suppressed via the real suppressCorrelatedCounts pipeline, and the final text never shows the 9/1 split", () => {
    const coverage: MetricCoverageStats = {
      currentActiveMemberCount: 10,
      recordedActiveMemberCount: 10,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 0,
    };
    const section: BooleanMetricDistributionSection = { kind: "BOOLEAN", counts: { trueCount: 9, falseCount: 1 } };
    const stats = suppressCorrelatedCounts(
      [
        coverage.currentActiveMemberCount,
        coverage.recordedActiveMemberCount,
        coverage.invalidActiveMemberCount,
        coverage.missingActiveMemberCount,
        0,
        section.counts.trueCount,
        section.counts.falseCount,
      ],
      { coverage, archivedContributingMemberCount: 0, section },
    );

    const allianceSection = baseSection({
      metricDistributions: [{ metricLabel: "Metric 1", summaryKind: MetricSummaryKind.TRUE_RATE, trendDirection: MetricTrendDirection.NEUTRAL, stats }],
    });
    const output = formatApsDataReadinessAuditReport(baseReport([allianceSection]));

    expect(output).toContain(SUPPRESSED);
    expect(output).not.toContain("true=9 false=1");
    expect(output).not.toContain("false=1");
  });

  // ---------------------------------------------------------------------
  // Comparable periods -- ONE bundle covering periodCount,
  // periodsWithBothDatesCount, comparablePairCount, and the duration
  // buckets together (review regression: periodCount used to be coarsened
  // independently of periodsWithBothDatesCount, so two individually-large
  // values close together, e.g. 20/19, could disclose "1 undated period"
  // by subtraction even though neither alone was small).
  // ---------------------------------------------------------------------

  it.each([1, 2, 3, 4])("suppresses the whole period bundle when the period count itself is small (%i), independently coarsening the unrelated pair count", (n) => {
    const section = baseSection({
      comparablePeriods: { periodCount: n, periodsWithBothDatesCount: 0, comparablePairCount: n, durationBucketCounts: { ...EMPTY_DURATION_BUCKETS } },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain(`Total periods: ${SUPPRESSED}`);
    // comparablePairCount has no total/subset relationship to periodCount
    // (different units: periods vs. pairs) -- it's coarsened standalone,
    // not swept into the period bundle's suppression.
    expect(output).toContain(`Comparable period pairs (equal duration, non-overlapping): 1-${MIN_CELL_SIZE - 1}`);
    expect(output).not.toMatch(new RegExp(`^- Total periods: ${n}$`, "m"));
  });

  it("renders exact period counts once every value (and every pairwise difference) clears MIN_CELL_SIZE", () => {
    const section = baseSection({
      comparablePeriods: { periodCount: MIN_CELL_SIZE, periodsWithBothDatesCount: 0, comparablePairCount: MIN_CELL_SIZE, durationBucketCounts: { ...EMPTY_DURATION_BUCKETS } },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain(`Total periods: ${MIN_CELL_SIZE}`);
  });

  it("equation-aware: suppresses BOTH periodCount and periodsWithBothDatesCount when each individually clears MIN_CELL_SIZE but their difference (undated periods) does not", () => {
    const section = baseSection({
      comparablePeriods: { periodCount: 20, periodsWithBothDatesCount: 19, comparablePairCount: 5, durationBucketCounts: { LTE_7_DAYS: 19, D8_TO_14_DAYS: 0, D15_TO_31_DAYS: 0, D32_PLUS_DAYS: 0 } },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    // Neither raw value (20, 19) is individually small, but their
    // difference (1 undated period) is -- the whole bundle must suppress.
    expect(output).toContain(`Total periods: ${SUPPRESSED}`);
    expect(output).toContain(`Periods with both start and end dates: ${SUPPRESSED}`);
    expect(output).not.toContain("Total periods: 20");
    expect(output).not.toContain("both start and end dates: 19");
  });

  it("renders 0 period counts exactly, not as a coarse range", () => {
    const output = formatApsDataReadinessAuditReport(baseReport([baseSection()]));
    expect(output).toContain("Total periods: 0");
    expect(output).not.toContain("Total periods: 1-4");
  });

  it.each([1, 2, 3, 4])(
    "suppresses the ENTIRE duration-bucket bundle (not just the small bucket) when one bucket is small (%i)",
    (n) => {
      const section = baseSection({
        comparablePeriods: {
          periodCount: 20,
          periodsWithBothDatesCount: 20,
          comparablePairCount: 5,
          // One small bucket, three large buckets, summing to the exact
          // total (20) shown above -- the arithmetic-recoverability case.
          durationBucketCounts: { LTE_7_DAYS: n, D8_TO_14_DAYS: 6, D15_TO_31_DAYS: 7, D32_PLUS_DAYS: 20 - n - 6 - 7 },
        },
      });

      const output = formatApsDataReadinessAuditReport(baseReport([section]));

      // The bundle line must show the suppression marker for EVERY bucket
      // AND for periodsWithBothDatesCount -- not the exact large buckets
      // alongside a coarsened small one, which would let a reader recover
      // the small bucket by subtracting the visible large ones from the
      // still-exact total.
      expect(output).toContain(`Periods with both start and end dates: ${SUPPRESSED}`);
      expect(output).toContain(`<=7d: ${SUPPRESSED}, 8-14d: ${SUPPRESSED}, 15-31d: ${SUPPRESSED}, 32d+: ${SUPPRESSED}`);
      expect(output).not.toContain("8-14d: 6");
      expect(output).not.toContain("15-31d: 7");
    },
  );

  it("renders every duration bucket exactly once all are 0 or >= MIN_CELL_SIZE", () => {
    const section = baseSection({
      comparablePeriods: {
        periodCount: 20,
        periodsWithBothDatesCount: 15,
        comparablePairCount: 5,
        durationBucketCounts: { LTE_7_DAYS: 15, D8_TO_14_DAYS: 0, D15_TO_31_DAYS: 0, D32_PLUS_DAYS: 0 },
      },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain("Periods with both start and end dates: 15");
    expect(output).toContain("<=7d: 15, 8-14d: 0, 15-31d: 0, 32d+: 0");
  });

  // ---------------------------------------------------------------------
  // Configured metrics (the composition bundle + the attachment bundle).
  // ---------------------------------------------------------------------

  it.each([1, 2, 3, 4])(
    "suppresses the ENTIRE metric-composition bundle when the archived count is small (%i) but the total and active count are large",
    (n) => {
      const section = baseSection({
        metricConfiguration: {
          totalMetricCount: 20,
          activeMetricCount: 20 - n,
          archivedMetricCount: n,
          byType: { [Metric_Type.NUMERIC]: 20, [Metric_Type.BOOLEAN]: 0 },
          bySummaryKind: Object.fromEntries(Object.values(MetricSummaryKind).map((k, i) => [k, i === 0 ? 20 : 0])) as Record<
            MetricSummaryKind,
            number
          >,
          byTrendDirection: Object.fromEntries(
            Object.values(MetricTrendDirection).map((k, i) => [k, i === 0 ? 20 : 0]),
          ) as Record<MetricTrendDirection, number>,
          activeAttachmentCount: 10,
          inactiveAttachmentCount: 10,
        },
      });

      const output = formatApsDataReadinessAuditReport(baseReport([section]));

      // If only `archived` were coarsened, `total (20) - active (20-n)`
      // would still recover it exactly -- so the WHOLE bundle, including
      // the otherwise-large total and active count, must be suppressed.
      expect(output).toContain(`Total metrics: ${SUPPRESSED} (active: ${SUPPRESSED}, archived: ${SUPPRESSED})`);
      expect(output).not.toContain("Total metrics: 20");
      expect(output).toContain(`${Metric_Type.NUMERIC}: ${SUPPRESSED}`);
      // The independent attachment bundle (10/10, both safe) is unaffected.
      expect(output).toContain("active: 10, inactive: 10");
    },
  );

  it.each([1, 2, 3, 4])("suppresses the attachment bundle independently of the (unrelated, large) metric-composition bundle", (n) => {
    const section = baseSection({
      metricConfiguration: {
        totalMetricCount: 20,
        activeMetricCount: 20,
        archivedMetricCount: 0,
        byType: { [Metric_Type.NUMERIC]: 20, [Metric_Type.BOOLEAN]: 0 },
        bySummaryKind: Object.fromEntries(Object.values(MetricSummaryKind).map((k, i) => [k, i === 0 ? 20 : 0])) as Record<
          MetricSummaryKind,
          number
        >,
        byTrendDirection: Object.fromEntries(
          Object.values(MetricTrendDirection).map((k, i) => [k, i === 0 ? 20 : 0]),
        ) as Record<MetricTrendDirection, number>,
        activeAttachmentCount: n,
        inactiveAttachmentCount: 10,
      },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain("Total metrics: 20 (active: 20, archived: 0)");
    expect(output).toContain(`active: ${SUPPRESSED}, inactive: ${SUPPRESSED}`);
  });

  it("renders the composition and attachment bundles exactly once every member clears MIN_CELL_SIZE or is 0", () => {
    const section = baseSection({
      metricConfiguration: {
        totalMetricCount: 20,
        activeMetricCount: 20,
        archivedMetricCount: 0,
        byType: { [Metric_Type.NUMERIC]: 20, [Metric_Type.BOOLEAN]: 0 },
        bySummaryKind: Object.fromEntries(Object.values(MetricSummaryKind).map((k, i) => [k, i === 0 ? 20 : 0])) as Record<
          MetricSummaryKind,
          number
        >,
        byTrendDirection: Object.fromEntries(
          Object.values(MetricTrendDirection).map((k, i) => [k, i === 0 ? 20 : 0]),
        ) as Record<MetricTrendDirection, number>,
        activeAttachmentCount: 10,
        inactiveAttachmentCount: 10,
      },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain("Total metrics: 20 (active: 20, archived: 0)");
    expect(output).toContain("active: 10, inactive: 10");
  });

  // ---------------------------------------------------------------------
  // Current period weights, stability, dogfood -- each its own bundle.
  // ---------------------------------------------------------------------

  it.each([1, 2, 3, 4])("suppresses the whole weight-component bundle when any member is small (%i), but never the weight sum", (n) => {
    const section = baseSection({
      currentPeriodWeights: { currentPeriodFound: true, activeComponentCount: 20, zeroWeightComponentCount: 20 - n, requiredComponentCount: n, weightSum: 42 },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain(`Active components: ${SUPPRESSED}`);
    expect(output).toContain(`Zero-weight components: ${SUPPRESSED}`);
    expect(output).toContain(`Required components: ${SUPPRESSED}`);
    expect(output).not.toContain("Active components: 20");
    // weightSum is a configuration VALUE, not a count of things -- never coarsened.
    expect(output).toContain("Weight sum: 42");
  });

  it("equation-aware: suppresses the weight bundle when active and required each individually clear MIN_CELL_SIZE but their difference (not-required components) does not", () => {
    const section = baseSection({
      currentPeriodWeights: { currentPeriodFound: true, activeComponentCount: 20, zeroWeightComponentCount: 5, requiredComponentCount: 19, weightSum: 42 },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain(`Active components: ${SUPPRESSED}`);
    expect(output).toContain(`Required components: ${SUPPRESSED}`);
    expect(output).not.toContain("Active components: 20");
    expect(output).not.toContain("Required components: 19");
    // weightSum is still never coarsened.
    expect(output).toContain("Weight sum: 42");
  });

  it.each([1, 2, 3, 4])(
    "coarsens only the small stability count (%i) to a range, leaving the other unrelated counts exact",
    (n) => {
      const section = baseSection({
        metricStability: { consecutivePeriodPairCount: 20, metricsAddedCount: n, metricsRemovedCount: 20, weightChangedCount: 20 },
      });

      const output = formatApsDataReadinessAuditReport(baseReport([section]));
      // consecutivePeriodPairCount, metricsRemovedCount, and
      // weightChangedCount have no total/subset relationship to
      // metricsAddedCount -- each is coarsened INDEPENDENTLY, so the small
      // added-count doesn't drag the others down with it.
      expect(output).toContain("Consecutive dated-period pairs: 20");
      expect(output).toContain(`Metrics added: 1-${MIN_CELL_SIZE - 1}`);
      expect(output).toContain("Metrics removed: 20");
      expect(output).toContain("Weights changed: 20");
    },
  );

  it("does not suppress metric stability counts that merely happen to be numerically close (added=11/removed=9), since they have no real equation linking them", () => {
    const section = baseSection({
      metricStability: { consecutivePeriodPairCount: 20, metricsAddedCount: 11, metricsRemovedCount: 9, weightChangedCount: 0 },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain("Metrics added: 11");
    expect(output).toContain("Metrics removed: 9");
    expect(output).not.toContain(SUPPRESSED);
  });

  it.each([1, 2, 3, 4])(
    "suppresses BOTH dogfood counts together when the small one (%i) would otherwise be recoverable from a large, exact total",
    (n) => {
      const section = baseSection({
        dogfoodReadiness: { totalMetricCount: 20, metricsWithEnoughObservationsCount: n, minPeriodsForDogfood: 3 },
      });

      const output = formatApsDataReadinessAuditReport(baseReport([section]));
      expect(output).toContain(`${SUPPRESSED} of ${SUPPRESSED} metrics have at least one valid recorded value in at least 3 distinct periods.`);
      expect(output).not.toContain("of 20 metrics");
    },
  );

  it("renders exact dogfood counts once both clear MIN_CELL_SIZE", () => {
    const section = baseSection({ dogfoodReadiness: { totalMetricCount: 20, metricsWithEnoughObservationsCount: 15, minPeriodsForDogfood: 3 } });
    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain("15 of 20 metrics have at least one valid recorded value in at least 3 distinct periods.");
  });

  it("never includes a raw metric or alliance name anywhere in the printed report", () => {
    const section = baseSection({ label: "Alliance A" });
    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).not.toMatch(/playerName/i);
    // Only the pseudonymous label format ("Alliance A") should ever appear for a name-like field.
    expect(output).toContain("## Alliance A");
  });
});
