/**
 * The (Metric_Type, MetricSummaryKind) compatibility matrix (#190) — the
 * single source of truth reused by:
 *   - metrics/action.ts's fast, friendly createMetric/editMetric validation
 *   - metricForm.tsx's client-side option filtering
 *   - the migration's DB CHECK constraint (metric_summary_kind_matches_type),
 *     which is the actual invariant; this module and the CHECK must agree.
 */
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";

export const METRIC_SUMMARY_KINDS_BY_TYPE: Record<Metric_Type, MetricSummaryKind[]> = {
  [Metric_Type.NUMERIC]: [MetricSummaryKind.NONE, MetricSummaryKind.SUM, MetricSummaryKind.AVERAGE],
  [Metric_Type.BOOLEAN]: [MetricSummaryKind.NONE, MetricSummaryKind.TRUE_RATE],
};

export function isValidSummaryKindForType(
  type: Metric_Type,
  summaryKind: MetricSummaryKind,
): boolean {
  return METRIC_SUMMARY_KINDS_BY_TYPE[type].includes(summaryKind);
}

/** Human-readable reason a (type, summaryKind) pairing was rejected, for form errors. */
export function describeSummaryKindMismatch(
  type: Metric_Type,
  summaryKind: MetricSummaryKind,
): string {
  if (summaryKind === MetricSummaryKind.SUM || summaryKind === MetricSummaryKind.AVERAGE) {
    return `${summaryKind === MetricSummaryKind.SUM ? "Total" : "Average"} requires a Numeric metric`;
  }
  if (summaryKind === MetricSummaryKind.TRUE_RATE) {
    return "True rate requires a Boolean metric";
  }
  return `${summaryKind} is not valid for a ${type.toLowerCase()} metric`;
}

export const METRIC_UNIT_LABEL_MAX_LENGTH = 24;

export type UnitLabelValidation =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Trim, strip control characters, and bound the optional unitLabel — same
 * validation style as accessRequestTriage.ts's bounded-text helpers. An
 * empty/whitespace-only input normalizes to `null` (no unit label), not a
 * validation error.
 */
export function validateUnitLabel(raw: string | null | undefined): UnitLabelValidation {
  if (raw == null) return { ok: true, value: null };
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  if (cleaned.length === 0) return { ok: true, value: null };
  if (cleaned.length > METRIC_UNIT_LABEL_MAX_LENGTH) {
    return {
      ok: false,
      message: `Unit label must be ${METRIC_UNIT_LABEL_MAX_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, value: cleaned };
}
