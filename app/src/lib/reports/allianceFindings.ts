import { MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { isAdverseComparisonChange } from "@/app/src/lib/metrics/metricTrendDirection";
import type { AllianceMetricPerformance } from "./getAlliancePerformanceReport";

/**
 * Deterministic "needs attention" findings for the alliance performance
 * overview (#264 PR2). A pure function over the same `AllianceMetricPerformance[]`
 * the overview cards already render — every finding is a direct,
 * explainable consequence of stored data (attachment/data status, coverage
 * counts, an explicit `trendDirection`), never a prediction, a heuristic
 * score, or an AI-authored judgment call. Given the same report, this
 * always returns the same findings.
 *
 * Findings are archived-metric-free by design: `metric.active === false`
 * metrics only appear in the report at all when they're attached to the
 * selected period (see `getAlliancePerformanceReport`'s metric universe
 * rule), and an archived metric's state is historical record, not something
 * a leader can act on going forward — so it never generates a finding.
 *
 * A NOT_ATTACHED metric also never generates a finding: being untracked in
 * one particular period is frequently intentional (different metrics run
 * on different cadences), and flagging every not-attached active metric
 * every period would drown out the findings that are actually actionable.
 * That state remains fully visible via the metric's own card and badge —
 * it just isn't elevated to "needs attention."
 */

export type AllianceFinding =
  | {
      kind: "INACTIVE_ATTACHMENT";
      metricId: string;
      metricName: string;
    }
  | {
      kind: "MISSING_RESULTS";
      metricId: string;
      metricName: string;
    }
  | {
      kind: "INVALID_VALUES";
      metricId: string;
      metricName: string;
      invalidCount: number;
    }
  | {
      kind: "INCOMPLETE_COVERAGE";
      metricId: string;
      metricName: string;
      missingCount: number;
      currentActiveMemberCount: number;
    }
  | {
      kind: "ADVERSE_COMPARISON";
      metricId: string;
      metricName: string;
      summaryKind: MetricSummaryKind;
      trendDirection: MetricTrendDirection;
      unitLabel: string | null;
      absoluteChange: number;
      percentageChange: number | null;
    };

/**
 * One metric's findings, in a fixed priority order. `INACTIVE_ATTACHMENT`
 * and `MISSING_RESULTS` are each exclusive of every other finding for that
 * same metric (an inactive attachment can't be recorded into regardless of
 * its coverage/comparison numbers, and a metric with zero recorded values
 * has no coverage gap or comparison to separately flag) — only the
 * data-quality/performance trio (`INVALID_VALUES`, `INCOMPLETE_COVERAGE`,
 * `ADVERSE_COMPARISON`) can co-occur on one metric.
 */
function findingsForMetric(performance: AllianceMetricPerformance): AllianceFinding[] {
  const { metric, attachmentStatus, dataStatus, coverage, comparison } = performance;

  // Archived metrics are historical record, not a forward-looking action item.
  if (!metric.active) return [];

  if (attachmentStatus === "NOT_ATTACHED") return [];

  if (attachmentStatus === "INACTIVE") {
    return [{ kind: "INACTIVE_ATTACHMENT", metricId: metric.id, metricName: metric.name }];
  }

  // attachmentStatus === "ACTIVE" from here on.
  if (dataStatus === "NO_VALUES") {
    return [{ kind: "MISSING_RESULTS", metricId: metric.id, metricName: metric.name }];
  }

  const findings: AllianceFinding[] = [];

  if (coverage.invalidActiveMemberCount > 0) {
    findings.push({
      kind: "INVALID_VALUES",
      metricId: metric.id,
      metricName: metric.name,
      invalidCount: coverage.invalidActiveMemberCount,
    });
  }

  if (coverage.missingActiveMemberCount > 0) {
    findings.push({
      kind: "INCOMPLETE_COVERAGE",
      metricId: metric.id,
      metricName: metric.name,
      missingCount: coverage.missingActiveMemberCount,
      currentActiveMemberCount: coverage.currentActiveMemberCount,
    });
  }

  if (
    comparison?.status === "COMPARED" &&
    metric.trendDirection !== MetricTrendDirection.NEUTRAL &&
    comparison.absoluteChange !== null &&
    isAdverseComparisonChange(metric.trendDirection, comparison.absoluteChange)
  ) {
    findings.push({
      kind: "ADVERSE_COMPARISON",
      metricId: metric.id,
      metricName: metric.name,
      summaryKind: metric.summaryKind,
      trendDirection: metric.trendDirection,
      unitLabel: metric.unitLabel,
      absoluteChange: comparison.absoluteChange,
      percentageChange: comparison.percentageChange,
    });
  }

  return findings;
}

/**
 * All findings across the alliance's metric universe, in the report's own
 * (already-deterministic) metric order — never re-sorted by "severity,"
 * since that would require a judgment call this engine deliberately
 * doesn't make.
 */
export function computeAllianceFindings(metrics: readonly AllianceMetricPerformance[]): AllianceFinding[] {
  return metrics.flatMap(findingsForMetric);
}
