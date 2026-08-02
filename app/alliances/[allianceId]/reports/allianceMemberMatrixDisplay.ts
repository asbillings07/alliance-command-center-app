import { Metric_Type } from "@/app/generated/prisma/enums";
import { formatMetricValue } from "@/app/src/lib/format/formatMetricValue";
import type { MatrixCell, MatrixColumnCandidate } from "@/app/src/lib/reports/allianceMemberMatrix";

/**
 * Pure presentation helpers for the member-by-metric matrix (#264 PR3).
 * Kept separate from the server/client components so cell formatting and
 * column-chooser labeling are unit-testable without rendering React.
 */

export type MatrixCellDisplay = { text: string; title?: string };

const NON_VALUE_CELL_TEXT: Record<Exclude<MatrixCell["status"], "VALUE">, string> = {
  MISSING: "Missing",
  INVALID: "Invalid",
  NOT_ATTACHED: "Not attached",
};

/**
 * Formats one cell for display. Boolean metrics render Yes/No even for a
 * `VALUE` cell (the raw 0/1 is never shown), matching the per-metric
 * report's roster convention (`reportRowDisplay.formatRowValue`).
 */
export function formatMatrixCell(cell: MatrixCell, column: MatrixColumnCandidate): MatrixCellDisplay {
  if (cell.status !== "VALUE") {
    return { text: NON_VALUE_CELL_TEXT[cell.status] };
  }
  if (column.type === Metric_Type.BOOLEAN) {
    return { text: cell.value === 1 ? "Yes" : "No" };
  }
  const formatted = formatMetricValue(cell.value as number, column.unitLabel);
  return { text: formatted.compact, title: formatted.exact };
}

/**
 * The column-chooser checkbox label — suffixes non-`ACTIVE` columns so a
 * leader isn't surprised to select a column that turns out empty for every
 * row. `ACTIVE` columns (the common case) get no suffix, matching the
 * report's existing "no badge for the normal state" convention
 * (`attachmentStatusBadge`).
 */
export function formatMatrixColumnChooserLabel(column: MatrixColumnCandidate): string {
  if (column.attachmentStatus === "NOT_ATTACHED") return `${column.name} (not attached)`;
  if (column.attachmentStatus === "INACTIVE") return `${column.name} (inactive)`;
  return column.name;
}
