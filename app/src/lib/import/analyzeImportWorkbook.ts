import {
  analyzeRows,
  detectTableBounds,
  isPlayerColumn,
  cellAddress,
  type ColumnInfo,
  type TableBoundsResult,
} from "@/app/src/lib/memberMatcher";
import type { ParsedWorkbook } from "@/app/src/lib/workbookParser";
import {
  buildPeriodMappingReview,
  type PeriodMappingReview,
} from "@/app/src/lib/import/periodProposal";

export type ImportWorkbookAnalysis = {
  rowCount: number;
  tableBounds: TableBoundsResult;
  selectedRegionIndex: number;
  headerRowIndex: number;
  playerColumn: ColumnInfo;
  numericColumns: ColumnInfo[];
  periodProposalReview: PeriodMappingReview;
};

export type AnalyzeImportWorkbookResult =
  | { ok: true; analysis: ImportWorkbookAnalysis }
  | { ok: false; error: string };

export function analyzeImportWorkbookSheet(
  workbook: ParsedWorkbook,
  sheetIndex: number,
  regionIndex: number = 0,
  overrideHeaderRowIndex?: number,
): AnalyzeImportWorkbookResult {
  const sheet = workbook.sheets[sheetIndex];
  if (!sheet || sheet.rows.length === 0) {
    return { ok: false, error: "The selected worksheet is empty." };
  }

  let bounds = detectTableBounds(sheet.rows);
  if (overrideHeaderRowIndex !== undefined && overrideHeaderRowIndex >= 0) {
    bounds = {
      ...bounds,
      headerRowIndex: overrideHeaderRowIndex,
      dataStartIndex: overrideHeaderRowIndex + 1,
    };
  }

  const result = analyzeRows(sheet.rows, bounds, regionIndex);
  if (result.tableBounds) {
    bounds = result.tableBounds;
  }
  if (result.error) {
    return { ok: false, error: result.error };
  }
  if (result.columns.length < 2) {
    return { ok: false, error: "Worksheet must have at least 2 columns in selected region" };
  }

  const textCols = result.columns.filter((c) => !c.isNumeric);
  const selectedRegion = bounds.tableRegions[regionIndex] || bounds.tableRegions[0];
  const playerColIdx = selectedRegion ? selectedRegion.playerColumnIndex : -1;
  const playerCol =
    result.columns.find((c) => c.index === playerColIdx) ||
    textCols.find((c) => isPlayerColumn(c.name)) ||
    textCols[0] ||
    null;

  if (!playerCol) {
    return { ok: false, error: "No player column found" };
  }

  const numCols = result.columns.filter((c) => c.isNumeric && c.index !== playerCol.index);

  const periodProposalReview = buildPeriodMappingReview({
    sheetName: sheet.name,
    tableRegionId: selectedRegion?.id,
    headerRowIndex: bounds.headerRowIndex,
    cellDates: sheet.cellDates,
    headers: result.columns.map((c) => ({
      columnIndex: c.index,
      headerText: c.name,
      headerAddress: cellAddress(bounds.headerRowIndex, c.index),
      isPlayerColumn: playerCol.index === c.index,
      isNumeric: c.isNumeric,
    })),
  });

  return {
    ok: true,
    analysis: {
      rowCount: result.rowCount,
      tableBounds: bounds,
      selectedRegionIndex: regionIndex,
      headerRowIndex: bounds.headerRowIndex,
      playerColumn: playerCol,
      numericColumns: numCols,
      periodProposalReview,
    },
  };
}
