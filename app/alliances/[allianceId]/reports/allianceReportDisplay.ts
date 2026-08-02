import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import type { BadgeVariant } from "@/app/src/components";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import type {
  MetricCoverage,
  MetricPeriodAttachmentStatus,
  MetricPeriodDataStatus,
  MetricRollup,
} from "@/app/src/lib/reports/getMetricSummaryReport";
import type { AllianceMetricComparison, AllianceOverallCoverage } from "@/app/src/lib/reports/getAlliancePerformanceReport";
import { formatRollupHeadline, formatRollupChange } from "./reportRollupDisplay";

/**
 * Pure presentation helpers for the alliance performance overview (#264).
 * Kept separate from the server components so every branch (attachment
 * status, summary kind, comparison status) is unit-testable without
 * rendering React.
 */

export type StatusBadge = { label: string; variant: BadgeVariant };

/** Null for ACTIVE — the "normal" state needs no badge, matching the per-metric drill-down page's convention. */
export function attachmentStatusBadge(status: MetricPeriodAttachmentStatus): StatusBadge | null {
  switch (status) {
    case "NOT_ATTACHED":
      return { label: "Not attached", variant: "warning" };
    case "INACTIVE":
      return { label: "Inactive attachment", variant: "neutral" };
    case "ACTIVE":
    default:
      return null;
  }
}

export const SUMMARY_KIND_BADGE_LABEL: Record<MetricSummaryKind, string | null> = {
  [MetricSummaryKind.SUM]: "Total",
  [MetricSummaryKind.AVERAGE]: "Average",
  [MetricSummaryKind.TRUE_RATE]: "True rate",
  [MetricSummaryKind.NONE]: null,
};

/**
 * Coverage is only a meaningful sentence when the metric has an active
 * attachment on the selected period — a NOT_ATTACHED/INACTIVE metric has no
 * cells a member could possibly have filled in, so "0 of N recorded" would
 * misrepresent a structural impossibility as an ordinary gap.
 */
export function formatCardCoverageSummary(
  attachmentStatus: MetricPeriodAttachmentStatus,
  coverage: MetricCoverage,
): string | null {
  if (attachmentStatus !== "ACTIVE") return null;
  if (coverage.currentActiveMemberCount === 0) return null;
  return `${coverage.recordedActiveMemberCount} of ${coverage.currentActiveMemberCount} active members recorded`;
}

/**
 * The short comparison line shown on each metric's card. `NO_DATA_IN_SELECTED_PERIOD`
 * intentionally renders nothing here — the card's own dataStatus-driven
 * "no results yet" messaging already covers it, so repeating it in the
 * comparison line would be redundant, not additive.
 */
export function formatCardComparisonSummary(
  comparison: AllianceMetricComparison | null,
  summaryKind: MetricSummaryKind,
  unitLabel: string | null,
): string | null {
  if (!comparison) return null;
  switch (comparison.status) {
    case "NOT_ATTACHED":
      return "Not attached in the comparison period";
    case "INACTIVE_ATTACHMENT":
      return "Inactive in the comparison period";
    case "NO_DATA_IN_COMPARISON_PERIOD":
      return "No results recorded in the comparison period";
    case "COMPARED":
      return formatRollupChange(summaryKind, comparison.absoluteChange, comparison.percentageChange, unitLabel);
    case "NO_ROLLUP":
    case "NO_DATA_IN_SELECTED_PERIOD":
    default:
      return null;
  }
}

export function formatOverallCoveragePercent(overallCoverage: AllianceOverallCoverage): string {
  return overallCoverage.coveragePercent === null ? "—" : formatPercent(overallCoverage.coveragePercent);
}

export type MetricCardBody =
  | { kind: "HEADLINE"; text: string }
  | { kind: "NO_VALUES"; text: string }
  | { kind: "NO_ROLLUP"; text: string };

/**
 * The card's main body message (#264), in priority order:
 *   1. No values at all — the message is attachment-aware, since "not
 *      attached" and "inactive" are structurally different from "active but
 *      nothing recorded yet."
 *   2. A NONE-kind metric *with* values — there's still no alliance-wide
 *      rollup to headline, even though members did record something.
 *   3. Otherwise, the formatted rollup headline.
 */
export function buildMetricCardBody(params: {
  dataStatus: MetricPeriodDataStatus;
  attachmentStatus: MetricPeriodAttachmentStatus;
  rollup: MetricRollup;
  unitLabel: string | null;
}): MetricCardBody {
  const { dataStatus, attachmentStatus, rollup, unitLabel } = params;

  if (dataStatus === "NO_VALUES") {
    const text =
      attachmentStatus === "NOT_ATTACHED"
        ? "Not attached to this period"
        : attachmentStatus === "INACTIVE"
          ? "No historical results"
          : "No results recorded yet";
    return { kind: "NO_VALUES", text };
  }

  if (rollup.kind === "NONE") {
    return { kind: "NO_ROLLUP", text: "Reported per-member — no alliance-wide rollup" };
  }

  return { kind: "HEADLINE", text: formatRollupHeadline(rollup, unitLabel) ?? "—" };
}
