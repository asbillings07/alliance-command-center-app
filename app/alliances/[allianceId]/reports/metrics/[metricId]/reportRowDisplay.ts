import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { formatMetricValue } from "@/app/src/lib/format/formatMetricValue";
import { formatMetricAverage } from "@/app/src/lib/format/formatMetricAverage";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import type { MetricInfo, MetricReportRow } from "@/app/src/lib/reports/getMetricSummaryReport";

export type RowValueDisplay = { text: string; title?: string };

/**
 * Rank is only ever shown for NUMERIC metrics (#190), even though the read
 * model computes a non-null rank for a NONE-kind BOOLEAN metric too (it
 * ranks by the raw 0/1 value). Displaying "rank" over a true/false roster
 * reads as ranking a coin flip rather than a leadership signal, so this is a
 * deliberate UI simplification on top of an otherwise-faithful backend
 * contract — not a bug if a BOOLEAN row's rank is silently dropped here.
 */
export function formatRowRank(row: MetricReportRow, metric: MetricInfo): string | null {
  if (metric.type !== Metric_Type.NUMERIC) return null;
  return row.rank !== null ? `#${row.rank}` : "—";
}

const BOOLEAN_STATUS_LABEL: Record<NonNullable<MetricReportRow["booleanStatus"]>, string> = {
  TRUE: "Yes",
  FALSE: "No",
  INVALID: "Invalid",
  MISSING: "Missing",
};

/** The member's value for this period, formatted for the roster table's Value column. */
export function formatRowValue(row: MetricReportRow, metric: MetricInfo): RowValueDisplay {
  if (metric.type === Metric_Type.BOOLEAN) {
    return { text: row.booleanStatus ? BOOLEAN_STATUS_LABEL[row.booleanStatus] : "Missing" };
  }
  if (row.value === null) {
    return { text: "Missing" };
  }
  const formatted = formatMetricValue(row.value, metric.unitLabel);
  return { text: formatted.compact, title: formatted.exact };
}

const SHARE_UNAVAILABLE_REASON_LABEL: Record<"NON_POSITIVE_TOTAL" | "NEGATIVE_VALUES_PRESENT", string> = {
  NON_POSITIVE_TOTAL: "Unavailable (total isn't positive)",
  NEGATIVE_VALUES_PRESENT: "Unavailable (total includes negative values)",
};

/**
 * The rollup-kind-specific fourth roster column: share of total (SUM) or
 * difference from the alliance average (AVERAGE). Null when the metric's
 * summary kind has no such column (TRUE_RATE, NONE) or the row has no
 * eligible value to show one for.
 */
export function formatRowKindSpecific(row: MetricReportRow, metric: MetricInfo): string | null {
  if (metric.summaryKind === MetricSummaryKind.SUM) {
    if (row.value === null || !row.share) return null;
    return row.share.available
      ? formatPercent(row.share.percentageOfTotal)
      : SHARE_UNAVAILABLE_REASON_LABEL[row.share.reason];
  }
  if (metric.summaryKind === MetricSummaryKind.AVERAGE) {
    if (row.differenceFromAverage === null) return null;
    const sign = row.differenceFromAverage > 0 ? "+" : "";
    return `${sign}${formatMetricAverage(row.differenceFromAverage, metric.unitLabel)}`;
  }
  return null;
}

/** Header label for the kind-specific fourth column, or null when the metric's summary kind has none. */
export function metricReportKindSpecificColumnLabel(summaryKind: MetricSummaryKind): string | null {
  if (summaryKind === MetricSummaryKind.SUM) return "Share of total";
  if (summaryKind === MetricSummaryKind.AVERAGE) return "Vs. average";
  return null;
}
