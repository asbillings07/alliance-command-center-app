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
 * `metric.active` (archived) suppresses exactly one thing: an archived
 * metric's own INACTIVE attachment isn't offered "reactivate" guidance,
 * since un-archiving the metric is a separate, deliberate step this finding
 * shouldn't second-guess. Everywhere else, archived status is irrelevant —
 * archiving a metric doesn't retroactively deactivate an already-active
 * attachment (see `findingsForMetric`), so an archived-but-still-attached
 * metric's data-quality and comparison findings are exactly as real and
 * actionable as an active metric's, and are never suppressed.
 *
 * A NOT_ATTACHED metric never generates a finding: being untracked in one
 * particular period is frequently intentional (different metrics run on
 * different cadences), and flagging every not-attached active metric every
 * period would drown out the findings that are actually actionable. That
 * state remains fully visible via the metric's own card and badge — it
 * just isn't elevated to "needs attention." The same reasoning covers a
 * non-`COMPARED` *comparison-period* status (`NOT_ATTACHED`,
 * `INACTIVE_ATTACHMENT`, `NO_DATA_IN_COMPARISON_PERIOD`, `NO_ROLLUP`,
 * `NO_DATA_IN_SELECTED_PERIOD`): that period's state is already visible on
 * the metric's own comparison summary text, so it's deliberately not
 * duplicated here as a second finding kind — only the *selected* period's
 * own attachment/data state, and an explicitly configured directional
 * comparison, are ever "needs attention."
 *
 * Findings are ordered by a fixed severity priority across metrics (see
 * `FINDING_KIND_PRIORITY`), not by the report's own metric order — see
 * `computeAllianceFindings`.
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

  if (attachmentStatus === "NOT_ATTACHED") return [];

  if (attachmentStatus === "INACTIVE") {
    // An archived metric's inactive attachment is expected end-of-life
    // history, not a prompt to "reactivate" — archiving was the leader's
    // own decision, and un-archiving is a separate step this finding
    // shouldn't second-guess.
    if (!metric.active) return [];
    return [{ kind: "INACTIVE_ATTACHMENT", metricId: metric.id, metricName: metric.name }];
  }

  // attachmentStatus === "ACTIVE" from here on — the metric is currently
  // receiving results regardless of `metric.active` (archived): archiving a
  // metric doesn't retroactively deactivate an already-active attachment,
  // so an archived metric can still be live for this period. Its
  // data-quality/comparison findings below are never suppressed for that
  // reason alone.
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
 * Deterministic display priority for each finding kind — the metric's
 * single most urgent finding kind determines where that metric's findings
 * sort relative to every other metric's. Lower number = higher priority
 * (surfaces first).
 *
 * Data that is actively *wrong* or *entirely absent* ranks highest, since
 * every other number for that metric is unreliable until it's fixed.
 * `INACTIVE_ATTACHMENT` — a structural block on any new data ever arriving
 * — ranks next. `ADVERSE_COMPARISON` ranks last: it's a real,
 * leader-configured performance signal, not a data defect, and calls for
 * judgment rather than a fix.
 */
const FINDING_KIND_PRIORITY: Record<AllianceFinding["kind"], number> = {
  INVALID_VALUES: 0,
  MISSING_RESULTS: 1,
  INCOMPLETE_COVERAGE: 2,
  INACTIVE_ATTACHMENT: 3,
  ADVERSE_COMPARISON: 4,
};

/**
 * All findings across the alliance's metric universe. Metrics are ordered
 * by their single most urgent finding kind (`FINDING_KIND_PRIORITY`), not
 * by the report's own metric order — a data-integrity problem further down
 * the metric list still outranks a comparison note on the first metric.
 * Each metric's own findings stay grouped together and in `findingsForMetric`'s
 * fixed internal order. `Array.prototype.sort` is spec-guaranteed stable,
 * so metrics tied on priority keep the report's original relative order.
 */
export function computeAllianceFindings(metrics: readonly AllianceMetricPerformance[]): AllianceFinding[] {
  const perMetricFindings = metrics.map(findingsForMetric).filter((findings) => findings.length > 0);

  const worstPriority = (findings: AllianceFinding[]) =>
    Math.min(...findings.map((finding) => FINDING_KIND_PRIORITY[finding.kind]));

  return [...perMetricFindings].sort((a, b) => worstPriority(a) - worstPriority(b)).flat();
}
