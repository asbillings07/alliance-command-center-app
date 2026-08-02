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
 * `metric.active` (archived) suppresses exactly two things, both because
 * they'd prompt an action that contradicts a decision the leader already
 * made by archiving the metric: `NOT_ATTACHED` (an archived metric that was
 * simply never attached to this period is fully retired, not "forgotten")
 * and `INACTIVE_ATTACHMENT` (no "reactivate" prompt for a metric someone
 * chose to archive — un-archiving is a separate, deliberate step this
 * finding shouldn't second-guess). Everywhere else, archived status is
 * irrelevant — archiving a metric doesn't retroactively deactivate an
 * already-active attachment (see `findingsForMetric`), so an
 * archived-but-still-attached metric's data-quality and comparison findings
 * are exactly as real and actionable as an active metric's, and are never
 * suppressed.
 *
 * An *active* metric not attached to the selected period **does** generate
 * a finding (`NOT_ATTACHED`): "not attached intentionally" (a different
 * cadence) and "not attached accidentally" (forgotten) are indistinguishable
 * from stored data alone, so the deterministic engine can't safely assume
 * either — it surfaces the gap and lets the leader decide, rather than
 * guessing on their behalf by staying silent.
 *
 * A non-`COMPARED` *comparison-period* status (`NOT_ATTACHED`,
 * `INACTIVE_ATTACHMENT`, `NO_DATA_IN_COMPARISON_PERIOD`) generates a
 * `COMPARISON_UNAVAILABLE` finding whenever a shared comparison period is
 * actually in effect (`comparison` non-null) — the leader explicitly (or by
 * accepting the recommended default) put a comparison in effect for every
 * metric, so "this metric couldn't be measured against it" is exactly as
 * relevant as the comparison succeeding, even though the metric's own card
 * already explains *why* in its comparison summary text. `NO_ROLLUP` (the
 * metric has no summaryKind configured, so no comparison could ever be
 * computed regardless of period) is deliberately excluded — that's a
 * metric-configuration fact independent of which period is selected, not a
 * comparison-period gap. No comparison finding of either kind is ever
 * generated when no comparison period is selected at all (`comparison`
 * null) — there's nothing to report a comparison against.
 *
 * Findings are ordered by a fixed severity priority across metrics (see
 * `FINDING_KIND_PRIORITY`), not by the report's own metric order — see
 * `computeAllianceFindings`.
 */

/** The three non-`COMPARED` comparison statuses `COMPARISON_UNAVAILABLE` can report — deliberately excludes `NO_ROLLUP` (a metric-config fact, not a comparison-period gap) and `NO_DATA_IN_SELECTED_PERIOD` (unreachable here; that state implies `dataStatus === "NO_VALUES"`, which already returns `MISSING_RESULTS` before comparison is ever evaluated). */
export type ComparisonUnavailableReason = "NOT_ATTACHED" | "INACTIVE_ATTACHMENT" | "NO_DATA_IN_COMPARISON_PERIOD";

export type AllianceFinding =
  | {
      kind: "NOT_ATTACHED";
      metricId: string;
      metricName: string;
    }
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
    }
  | {
      kind: "COMPARISON_UNAVAILABLE";
      metricId: string;
      metricName: string;
      reason: ComparisonUnavailableReason;
    };

const COMPARISON_UNAVAILABLE_REASONS: readonly ComparisonUnavailableReason[] = [
  "NOT_ATTACHED",
  "INACTIVE_ATTACHMENT",
  "NO_DATA_IN_COMPARISON_PERIOD",
];

/**
 * One metric's findings, in a fixed priority order. `NOT_ATTACHED`,
 * `INACTIVE_ATTACHMENT`, and `MISSING_RESULTS` are each exclusive of every
 * other finding for that same metric (there's no coverage/comparison to
 * separately flag when the metric isn't even receiving data this period) —
 * only the data-quality/comparison group (`INVALID_VALUES`,
 * `INCOMPLETE_COVERAGE`, and exactly one of `ADVERSE_COMPARISON` /
 * `COMPARISON_UNAVAILABLE`) can co-occur on one metric.
 */
function findingsForMetric(performance: AllianceMetricPerformance): AllianceFinding[] {
  const { metric, attachmentStatus, dataStatus, coverage, comparison } = performance;

  if (attachmentStatus === "NOT_ATTACHED") {
    // An archived metric that was simply never attached to this period is
    // fully retired, not "forgotten" — nothing to attach (it's already
    // archived) or archive (already done). An *active* metric left
    // unattached is exactly the ambiguous case this finding exists for.
    if (!metric.active) return [];
    return [{ kind: "NOT_ATTACHED", metricId: metric.id, metricName: metric.name }];
  }

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

  // A shared comparison period is only in effect at all when `comparison`
  // is non-null (see the type's own doc comment on `AllianceMetricPerformance`)
  // — nothing below fires when no comparison was selected.
  if (comparison && isComparisonUnavailableReason(comparison.status)) {
    findings.push({
      kind: "COMPARISON_UNAVAILABLE",
      metricId: metric.id,
      metricName: metric.name,
      reason: comparison.status,
    });
  } else if (
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

function isComparisonUnavailableReason(status: string): status is ComparisonUnavailableReason {
  return (COMPARISON_UNAVAILABLE_REASONS as readonly string[]).includes(status);
}

/**
 * Deterministic display priority for each finding kind — the metric's
 * single most urgent finding kind determines where that metric's findings
 * sort relative to every other metric's. Lower number = higher priority
 * (surfaces first).
 *
 * Data that is actively *wrong* or *entirely absent this period* ranks
 * highest, since every other number for that metric is unreliable until
 * it's fixed. Structural gaps in the *selected* period (`NOT_ATTACHED`,
 * then `INACTIVE_ATTACHMENT`) rank next — a decision (attach/reactivate or
 * archive) is needed before any data can flow at all. Comparison-related
 * findings rank last, since they're about the metric's *trend*, not
 * whether its current-period data can be trusted: `ADVERSE_COMPARISON` is a
 * real, leader-configured performance signal calling for judgment, and
 * `COMPARISON_UNAVAILABLE` ranks lowest of all — purely informational
 * (the comparison period is already closed; there's nothing to fix).
 */
const FINDING_KIND_PRIORITY: Record<AllianceFinding["kind"], number> = {
  INVALID_VALUES: 0,
  MISSING_RESULTS: 1,
  INCOMPLETE_COVERAGE: 2,
  NOT_ATTACHED: 3,
  INACTIVE_ATTACHMENT: 4,
  ADVERSE_COMPARISON: 5,
  COMPARISON_UNAVAILABLE: 6,
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
