import { describe, expect, it } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { MIN_CELL_SIZE } from "./apsAuditPrivacy";
import { formatApsDataReadinessAuditReport } from "./apsAuditReportFormat";
import type { AllianceAuditSection, ApsDataReadinessAuditReport } from "./apsDataReadinessAudit";

/**
 * Final-output regressions (#284 PR A review): everything above this module
 * assembles an in-memory report; these tests check the actual printed
 * string -- the only thing that ever reaches stdout -- for both member-level
 * suppression and alliance-configuration coarsening, at exactly the small
 * (1-4) sample sizes the review flagged as previously unprotected.
 */

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

    expect(output).toContain(`suppressed (cell size < ${MIN_CELL_SIZE})`);
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

  it.each([1, 2, 3, 4])(
    "coarsens a small (%i) comparable-period count to a range instead of the exact number",
    (n) => {
      const section = baseSection({
        comparablePeriods: {
          periodCount: n,
          periodsWithBothDatesCount: n,
          comparablePairCount: n,
          durationBucketCounts: { ...EMPTY_DURATION_BUCKETS, LTE_7_DAYS: n },
        },
      });

      const output = formatApsDataReadinessAuditReport(baseReport([section]));
      const range = `1-${MIN_CELL_SIZE - 1}`;
      expect(output).toContain(`Total periods: ${range}`);
      expect(output).toContain(`Periods with both start and end dates: ${range}`);
      expect(output).toContain(`Comparable period pairs (equal duration, non-overlapping): ${range}`);
      expect(output).toContain(`<=7d: ${range}`);
      // Exact-line check (not `.not.toContain`, which would false-pass for
      // n=1 since "Total periods: 1" is a substring of "Total periods: 1-4").
      expect(output).not.toMatch(new RegExp(`^- Total periods: ${n}$`, "m"));
    },
  );

  it("renders exact comparable-period counts once they clear MIN_CELL_SIZE", () => {
    const section = baseSection({
      comparablePeriods: {
        periodCount: MIN_CELL_SIZE,
        periodsWithBothDatesCount: MIN_CELL_SIZE,
        comparablePairCount: MIN_CELL_SIZE,
        durationBucketCounts: { ...EMPTY_DURATION_BUCKETS, LTE_7_DAYS: MIN_CELL_SIZE },
      },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).toContain(`Total periods: ${MIN_CELL_SIZE}`);
  });

  it("renders 0 comparable-period counts exactly, not as a coarse range", () => {
    const output = formatApsDataReadinessAuditReport(baseReport([baseSection()]));
    expect(output).toContain("Total periods: 0");
    expect(output).not.toContain("Total periods: 1-4");
  });

  it.each([1, 2, 3, 4])("coarsens a small (%i) metric-configuration and attachment count", (n) => {
    const section = baseSection({
      metricConfiguration: {
        totalMetricCount: n,
        activeMetricCount: n,
        archivedMetricCount: n,
        byType: { [Metric_Type.NUMERIC]: n, [Metric_Type.BOOLEAN]: 0 },
        bySummaryKind: Object.fromEntries(Object.values(MetricSummaryKind).map((k, i) => [k, i === 0 ? n : 0])) as Record<
          MetricSummaryKind,
          number
        >,
        byTrendDirection: Object.fromEntries(
          Object.values(MetricTrendDirection).map((k, i) => [k, i === 0 ? n : 0]),
        ) as Record<MetricTrendDirection, number>,
        activeAttachmentCount: n,
        inactiveAttachmentCount: n,
      },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    const range = `1-${MIN_CELL_SIZE - 1}`;
    expect(output).toContain(`Total metrics: ${range} (active: ${range}, archived: ${range})`);
    expect(output).toContain(`${Metric_Type.NUMERIC}: ${range}`);
    expect(output).toContain(`active: ${range}, inactive: ${range}`);
    expect(output).not.toContain(`Total metrics: ${n} `);
  });

  it.each([1, 2, 3, 4])("coarsens a small (%i) current-period weight-component count but never the weight sum itself", (n) => {
    const section = baseSection({
      currentPeriodWeights: {
        currentPeriodFound: true,
        activeComponentCount: n,
        zeroWeightComponentCount: n,
        requiredComponentCount: n,
        weightSum: 42,
      },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    const range = `1-${MIN_CELL_SIZE - 1}`;
    expect(output).toContain(`Active components: ${range}`);
    expect(output).toContain(`Zero-weight components: ${range}`);
    expect(output).toContain(`Required components: ${range}`);
    // weightSum is a configuration VALUE, not a count of things -- never coarsened.
    expect(output).toContain("Weight sum: 42");
  });

  it.each([1, 2, 3, 4])("coarsens a small (%i) configuration-stability change count", (n) => {
    const section = baseSection({
      metricStability: { consecutivePeriodPairCount: n, metricsAddedCount: n, metricsRemovedCount: n, weightChangedCount: n },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    const range = `1-${MIN_CELL_SIZE - 1}`;
    expect(output).toContain(`Consecutive dated-period pairs: ${range}`);
    expect(output).toContain(`Metrics added: ${range}`);
    expect(output).toContain(`Metrics removed: ${range}`);
    expect(output).toContain(`Weights changed: ${range}`);
  });

  it.each([1, 2, 3, 4])("coarsens a small (%i) dogfood-readiness count", (n) => {
    const section = baseSection({
      dogfoodReadiness: { totalMetricCount: n, metricsWithEnoughObservationsCount: n, minPeriodsForDogfood: 3 },
    });

    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    const range = `1-${MIN_CELL_SIZE - 1}`;
    expect(output).toContain(`${range} of ${range} metrics have at least one valid recorded value in at least 3 distinct periods.`);
  });

  it("never includes a raw metric or alliance name anywhere in the printed report", () => {
    const section = baseSection({ label: "Alliance A" });
    const output = formatApsDataReadinessAuditReport(baseReport([section]));
    expect(output).not.toMatch(/playerName/i);
    // Only the pseudonymous label format ("Alliance A") should ever appear for a name-like field.
    expect(output).toContain("## Alliance A");
  });
});
