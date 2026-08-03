import { Metric_Type } from "@/app/generated/prisma/enums";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";
import type { MemberRosterFilter, MetricPeriodAttachmentStatus } from "@/app/src/lib/reports/getMetricSummaryReport";

/**
 * Pure domain types and logic for the member-by-metric matrix (#264 PR3).
 * No `"server-only"`, no Prisma — deliberately separate from
 * `getAllianceMemberMetricMatrix.ts` (the DB orchestration) so client
 * components (the column chooser, controls) can import these types/pure
 * functions without pulling `pg`/Prisma into the browser bundle. Mirrors
 * the existing `allianceFindings.ts` (pure) / `getAlliancePerformanceReport.ts`
 * (DB) split.
 */

/** Excludes the sticky member-name column (#264 PR3 decision). */
export const MATRIX_MAX_COLUMNS = 6;

export type MatrixColumnCandidate = {
  id: string;
  name: string;
  type: Metric_Type;
  unitLabel: string | null;
  attachmentStatus: MetricPeriodAttachmentStatus;
  /**
   * The *metric's own* active/archived state — independent of
   * `attachmentStatus` (which is period-scoped). An archived metric can
   * still be `ACTIVE`-attached with real values for a past period (the
   * report's inclusion rule keeps it visible as long as it has results
   * this period), so both states must be surfaced: "archived" says
   * "leadership retired this metric," "inactive/not attached" says
   * "nothing recorded against it this period."
   */
  metricActive: boolean;
};

export type MatrixSortKey =
  | { kind: "name"; direction: "asc" | "desc" }
  | { kind: "metric"; metricId: string; direction: "asc" | "desc" };

export type MatrixCellStatus = "VALUE" | "INVALID" | "MISSING" | "NOT_ATTACHED";

export type MatrixCell = {
  metricId: string;
  status: MatrixCellStatus;
  /** Raw stored value. Present for VALUE/INVALID; null for MISSING/NOT_ATTACHED. */
  value: number | null;
};

export type MatrixRow = {
  allianceMemberId: string;
  playerName: string;
  archived: boolean;
  /** Aligned 1:1 with `AllianceMemberMetricMatrix.columns`, in the same order. */
  cells: MatrixCell[];
};

export type AllianceMemberMetricMatrix = {
  /** The resolved, rendered columns — never more than `MATRIX_MAX_COLUMNS`, server-enforced regardless of what was requested. */
  columns: MatrixColumnCandidate[];
  /** The full candidate universe (same metric universe as the alliance report), for the column chooser UI. */
  availableColumns: MatrixColumnCandidate[];
  rows: MatrixRow[];
  pagination: { page: number; pageSize: number; totalRowCount: number };
  sort: MatrixSortKey;
  filter: MemberRosterFilter;
  /** The bounded, trimmed search term actually applied (may differ from raw input if it was truncated). */
  search: string;
};

/**
 * Resolves which metrics render as matrix columns. Server-enforced: a
 * `matrixColumns` URL param can only ever *narrow* the already-computed
 * candidate universe for this alliance/period — it can never smuggle in a
 * metric ID from another alliance, exceed `MATRIX_MAX_COLUMNS`, or reorder
 * columns away from the report's own stable order (selection order in the
 * request is intentionally ignored; `candidates`' order always wins, so the
 * rendered column order never depends on checkbox click order).
 *
 * Falls back to the default selection — every candidate if there are
 * `MATRIX_MAX_COLUMNS` or fewer, otherwise the first `MATRIX_MAX_COLUMNS` —
 * both when no selection was requested and when a requested selection
 * resolves to zero valid columns (e.g. every requested ID was stale/invalid).
 */
export function resolveMatrixColumns(
  candidates: readonly MatrixColumnCandidate[],
  requestedIds: readonly string[] | undefined,
): MatrixColumnCandidate[] {
  const defaultSelection = candidates.slice(0, MATRIX_MAX_COLUMNS);
  if (!requestedIds || requestedIds.length === 0) return defaultSelection;

  const requested = new Set(requestedIds);
  const resolved = candidates.filter((candidate) => requested.has(candidate.id)).slice(0, MATRIX_MAX_COLUMNS);
  return resolved.length > 0 ? resolved : defaultSelection;
}

/**
 * Resolves the matrix's single active sort key. Only member name or one
 * currently-*selected*, currently-`ACTIVE`-attachment column may be a sort
 * key (#264 PR3 decision) — a not-attached column has no possible values to
 * sort by, and an inactive column's frozen historical data is deliberately
 * excluded from sorting even though it's still shown. Any other request
 * (an unselected metric, a non-sortable column, garbage input) falls back
 * to the default: name ascending.
 */
export function normalizeMatrixSort(
  requestedSort: string | undefined | null,
  requestedDirection: string | undefined | null,
  selectedColumns: readonly MatrixColumnCandidate[],
): MatrixSortKey {
  const direction: "asc" | "desc" = requestedDirection === "desc" ? "desc" : "asc";

  if (!requestedSort || requestedSort === "name") {
    return { kind: "name", direction };
  }

  const column = selectedColumns.find((c) => c.id === requestedSort && c.attachmentStatus === "ACTIVE");
  if (!column) {
    return { kind: "name", direction };
  }

  return { kind: "metric", metricId: column.id, direction };
}

/**
 * A `NOT_ATTACHED` column has no possible entries this period at all (the
 * schema's FK makes an entry impossible without *some* attachment row) —
 * every row shows that state uniformly, without needing a per-row query.
 * An `INACTIVE` column, by contrast, can still carry real historical values
 * (deactivating an attachment doesn't delete its entries), so its cells
 * show the actual VALUE/INVALID/MISSING state — "inactive" is surfaced as a
 * column-level badge, not a per-cell status, matching how attachment status
 * is already shown everywhere else in this report.
 */
export function buildCell(column: MatrixColumnCandidate, rawValue: number | null): MatrixCell {
  if (column.attachmentStatus === "NOT_ATTACHED") {
    return { metricId: column.id, status: "NOT_ATTACHED", value: null };
  }
  if (rawValue === null) {
    return { metricId: column.id, status: "MISSING", value: null };
  }
  if (column.type === Metric_Type.BOOLEAN && !isValidBooleanMetricValue(rawValue)) {
    return { metricId: column.id, status: "INVALID", value: rawValue };
  }
  return { metricId: column.id, status: "VALUE", value: rawValue };
}
