import type { BadgeVariant } from "@/app/src/components";
import type { AllianceFinding, ComparisonUnavailableReason } from "@/app/src/lib/reports/allianceFindings";
import { METRIC_TREND_DIRECTION_LABELS } from "@/app/src/lib/metrics/metricTrendDirection";
import { formatRollupChange } from "./reportRollupDisplay";

/**
 * Pure presentation helpers for the "needs attention" findings section
 * (#264 PR2) — kept separate from the server component so every finding
 * kind is unit-testable without rendering React, matching the pattern in
 * `allianceReportDisplay.ts`.
 */

export const FINDING_KIND_BADGE: Record<AllianceFinding["kind"], { label: string; variant: BadgeVariant }> = {
  NOT_ATTACHED: { label: "Not attached", variant: "warning" },
  INACTIVE_ATTACHMENT: { label: "Inactive attachment", variant: "neutral" },
  MISSING_RESULTS: { label: "No results", variant: "warning" },
  INVALID_VALUES: { label: "Invalid values", variant: "danger" },
  INCOMPLETE_COVERAGE: { label: "Incomplete coverage", variant: "warning" },
  ADVERSE_COMPARISON: { label: "Adverse change", variant: "danger" },
  COMPARISON_UNAVAILABLE: { label: "Comparison unavailable", variant: "neutral" },
};

/** The clause naming *why* the comparison period couldn't be measured, preserving the underlying reason in the copy rather than a generic "unavailable." */
const COMPARISON_UNAVAILABLE_REASON_TEXT: Record<ComparisonUnavailableReason, string> = {
  NOT_ATTACHED: "wasn't attached in the comparison period",
  INACTIVE_ATTACHMENT: "had an inactive attachment in the comparison period",
  NO_DATA_IN_COMPARISON_PERIOD: "had no recorded results in the comparison period",
};

/**
 * ADVERSE_COMPARISON is the one finding kind whose text can call a change
 * "adverse" — every other line in the alliance report (comparison
 * summaries, at-a-glance counts) stays strictly neutral (#264 PR1), because
 * the schema has no opinion on directionality. This finding only exists
 * *because* a leader explicitly configured `trendDirection` away from
 * NEUTRAL, so "adverse" here is their judgment, not the platform's — but
 * the *magnitude* is still just the same plain signed number
 * (`formatRollupChange`) used everywhere else; there's no separate
 * "increased"/"decreased" word to keep it consistent with, and no risk of
 * a redundant double-sign ("decreased -50 pts").
 */
export function formatFindingText(finding: AllianceFinding): string {
  switch (finding.kind) {
    case "NOT_ATTACHED":
      return `${finding.metricName} isn't attached to this period, so no results can be recorded for it. Attach it to start tracking, or archive it if it's no longer relevant.`;
    case "INACTIVE_ATTACHMENT":
      return `Attachment for ${finding.metricName} is inactive this period. Reactivate it to resume recording new results.`;
    case "MISSING_RESULTS":
      return `${finding.metricName} has no results recorded yet this period. Record results for active members to start tracking it.`;
    case "INVALID_VALUES":
      return `${finding.metricName} has ${finding.invalidCount} active member${
        finding.invalidCount === 1 ? "" : "s"
      } with an invalid recorded value. Review and correct the invalid ${
        finding.invalidCount === 1 ? "entry" : "entries"
      }.`;
    case "INCOMPLETE_COVERAGE":
      return `${finding.metricName}: ${finding.missingCount} of ${finding.currentActiveMemberCount} active members haven't recorded a value. Record results for the remaining members to complete coverage.`;
    case "ADVERSE_COMPARISON": {
      const change = formatRollupChange(
        finding.summaryKind,
        finding.absoluteChange,
        finding.percentageChange,
        finding.unitLabel,
      );
      const directionLabel = METRIC_TREND_DIRECTION_LABELS[finding.trendDirection].toLowerCase();
      return `${finding.metricName} changed ${
        change ?? "unfavorably"
      } since the comparison period (configured as ${directionLabel}). Review the drill-down for member-level detail.`;
    }
    case "COMPARISON_UNAVAILABLE":
      return `${finding.metricName} ${
        COMPARISON_UNAVAILABLE_REASON_TEXT[finding.reason]
      }, so no change could be measured. Review the drill-down for detail.`;
    default: {
      // Exhaustive, fail-closed: a new AllianceFinding kind added without a
      // case here is a compile error (the `never` assignment), and if one
      // somehow still reaches this branch at runtime, throwing beats
      // silently rendering a blank findings row that hides missing copy.
      const exhaustiveCheck: never = finding;
      throw new Error(`Unhandled finding kind: ${(exhaustiveCheck as AllianceFinding).kind}`);
    }
  }
}
