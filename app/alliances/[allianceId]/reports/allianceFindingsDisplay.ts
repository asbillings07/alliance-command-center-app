import type { BadgeVariant } from "@/app/src/components";
import type { AllianceFinding } from "@/app/src/lib/reports/allianceFindings";
import { METRIC_TREND_DIRECTION_LABELS } from "@/app/src/lib/metrics/metricTrendDirection";
import { formatRollupChange } from "./reportRollupDisplay";

/**
 * Pure presentation helpers for the "needs attention" findings section
 * (#264 PR2) — kept separate from the server component so every finding
 * kind is unit-testable without rendering React, matching the pattern in
 * `allianceReportDisplay.ts`.
 */

export const FINDING_KIND_BADGE: Record<AllianceFinding["kind"], { label: string; variant: BadgeVariant }> = {
  INACTIVE_ATTACHMENT: { label: "Inactive attachment", variant: "neutral" },
  MISSING_RESULTS: { label: "No results", variant: "warning" },
  INVALID_VALUES: { label: "Invalid values", variant: "danger" },
  INCOMPLETE_COVERAGE: { label: "Incomplete coverage", variant: "warning" },
  ADVERSE_COMPARISON: { label: "Adverse change", variant: "danger" },
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
    case "INACTIVE_ATTACHMENT":
      return `Attachment for ${finding.metricName} is inactive this period — no new results can be recorded until it's reactivated.`;
    case "MISSING_RESULTS":
      return `${finding.metricName} has no results recorded yet this period.`;
    case "INVALID_VALUES":
      return `${finding.metricName} has ${finding.invalidCount} active member${
        finding.invalidCount === 1 ? "" : "s"
      } with an invalid recorded value.`;
    case "INCOMPLETE_COVERAGE":
      return `${finding.metricName}: ${finding.missingCount} of ${finding.currentActiveMemberCount} active members haven't recorded a value.`;
    case "ADVERSE_COMPARISON": {
      const change = formatRollupChange(
        finding.summaryKind,
        finding.absoluteChange,
        finding.percentageChange,
        finding.unitLabel,
      );
      const directionLabel = METRIC_TREND_DIRECTION_LABELS[finding.trendDirection].toLowerCase();
      return `${finding.metricName} changed ${change ?? "unfavorably"} since the comparison period (configured as ${directionLabel}).`;
    }
    default:
      return "";
  }
}
