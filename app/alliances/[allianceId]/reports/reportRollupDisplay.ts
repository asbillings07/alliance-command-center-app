import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import { formatMetricValue } from "@/app/src/lib/format/formatMetricValue";
import { formatMetricAverage } from "@/app/src/lib/format/formatMetricAverage";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import type { MetricRollup } from "@/app/src/lib/reports/getMetricSummaryReport";

function signedPrefix(value: number): string {
  return value > 0 ? "+" : "";
}

/** Formats a rollup's headline value (#190). Null only for NONE — there's no rollup to show. */
export function formatRollupHeadline(rollup: MetricRollup, unitLabel: string | null): string | null {
  switch (rollup.kind) {
    case "SUM":
      return formatMetricValue(rollup.total, unitLabel).compact;
    case "AVERAGE":
      return rollup.average === null ? null : formatMetricAverage(rollup.average, unitLabel);
    case "TRUE_RATE":
      return rollup.trueRate === null ? null : formatPercent(rollup.trueRate);
    case "NONE":
    default:
      return null;
  }
}

/**
 * Formats a period-over-period rollup change for display. Returns null when
 * there's nothing to show for this summary kind (or the underlying change
 * couldn't be computed, e.g. every entry was a legacy invalid boolean
 * value) — callers should render nothing in that case, not a fabricated
 * zero.
 */
export function formatRollupChange(
  summaryKind: MetricSummaryKind,
  absoluteChange: number | null,
  percentageChange: number | null,
  unitLabel: string | null,
): string | null {
  if (summaryKind === MetricSummaryKind.SUM || summaryKind === MetricSummaryKind.AVERAGE) {
    if (absoluteChange === null) return null;
    const formatValue =
      summaryKind === MetricSummaryKind.SUM
        ? formatMetricValue(absoluteChange, unitLabel).compact
        : formatMetricAverage(absoluteChange, unitLabel);
    const abs = `${signedPrefix(absoluteChange)}${formatValue}`;
    const pct = percentageChange === null ? "unavailable" : formatPercent(percentageChange, { signed: true });
    return `${abs} (${pct})`;
  }
  if (summaryKind === MetricSummaryKind.TRUE_RATE) {
    if (absoluteChange === null) return null;
    return formatPercent(absoluteChange, { unit: "pp", signed: true });
  }
  return null;
}
