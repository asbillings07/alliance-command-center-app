/**
 * Member matching utilities for CSV, XLSX, XLS import, OCR, and other data sources.
 * Decoupled from data source to allow reuse across different import methods.
 */

import { parseStrictInteger, isValidIntegerString } from "./numberParser";
import {
  PLAYER_COLUMN_NAMES,
  THP_COLUMN_NAMES,
  ROLE_COLUMN_NAMES,
  POWER_COLUMN_NAMES,
  normalizeColumnName,
  isPlayerColumn,
  detectColumn,
  type ColumnInfo,
} from "./importConstants";

export {
  PLAYER_COLUMN_NAMES,
  THP_COLUMN_NAMES,
  ROLE_COLUMN_NAMES,
  POWER_COLUMN_NAMES,
  normalizeColumnName,
  isPlayerColumn,
  detectColumn,
  type ColumnInfo,
};

type MemberRecord = {
  id: string;
  playerName: string;
};

export type RawEntry = {
  name: string;
  value?: number;
  rawValue: string;
  sourceRow: number;
  error?: string;
};

export type ValidMetricEntry = {
  name: string;
  value: number;
  rawValue: string;
  sourceRow: number;
  columnIndex: number;
  address: string;
  metricName: string;
};

export type SkippedBlankCell = {
  sourceRow: number;
  columnIndex: number;
  address: string;
  rawName: string;
  metricName: string;
};

export type InvalidValueIssue = {
  sourceRow: number;
  columnIndex: number;
  address: string;
  rawName: string;
  metricName: string;
  rawValue: string;
  error: string;
};

export type MissingIdentityIssue = {
  sourceRow: number;
  columnIndex: number;
  nameColumnIndex: number;
  address: string;
  nameAddress: string;
  metricName: string;
  rawValue: string;
  error: string;
};

export type UnmatchedMemberIssue = {
  sourceRow: number;
  rawName: string;
  metricName: string;
  rawValue: string;
};

export type DuplicateMemberIssue = {
  sourceRow: number;
  rawName: string;
  metricName: string;
  firstSeenRow: number;
};

export type HeaderCandidate = {
  rowIndex: number;
  score: number;
  sampleHeaders: string[];
};

export type TableRegion = {
  id: string;
  name: string;
  startColumn: number;
  endColumn: number;
  playerColumnIndex: number;
  playerColumnName: string;
  headerRowIndex: number;
  dataStartIndex: number;
  dataEndIndex: number;
  hasExcludedDataBelow: boolean;
  excludedRowsCount: number;
};

export type TableBoundsResult = {
  headerRowIndex: number;
  dataStartIndex: number;
  dataEndIndex: number; // exclusive upper index for rows.slice(dataStartIndex, dataEndIndex)
  confidence: "high" | "medium" | "low";
  candidates: HeaderCandidate[];
  needsConfirmation: boolean;
  tableRegions: TableRegion[];
  selectedRegionIndex: number;
  hasExcludedDataBelow: boolean;
  excludedRowsCount: number;
};

export type MatchResult = {
  rawName: string;
  value?: number;
  rawValue: string;
  sourceRow: number;
  error?: string;
  status: "matched" | "unmatched" | "duplicate" | "invalid_value";
  memberId?: string;
  matchedName?: string;
  confidence: number;
};

export type MatchSummary = {
  results: MatchResult[];
  matched: number;
  unmatched: number;
  duplicates: number;
  total: number;
};

/**
 * Normalize a name for comparison (lowercase, trim, remove extra spaces)
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a score between 0 and 1, where 1 is an exact match
 */
export function calculateSimilarity(a: string, b: string): number {
  const normalizedA = normalizeName(a);
  const normalizedB = normalizeName(b);

  if (normalizedA === normalizedB) return 1;

  const longer =
    normalizedA.length > normalizedB.length ? normalizedA : normalizedB;
  const shorter =
    normalizedA.length > normalizedB.length ? normalizedB : normalizedA;

  if (longer.length === 0) return 1;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Levenshtein distance implementation
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find the best matching member for a given name
 * Returns the member with the highest similarity score above the threshold
 */
function findBestMatch(
  name: string,
  members: MemberRecord[],
  threshold: number = 0.7,
): { member: MemberRecord; confidence: number } | null {
  let bestMatch: MemberRecord | null = null;
  let bestScore = 0;

  for (const member of members) {
    const score = calculateSimilarity(name, member.playerName);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = member;
    }
  }

  if (bestMatch) {
    return { member: bestMatch, confidence: bestScore };
  }

  return null;
}

/**
 * Match raw entries (from CSV, XLSX, OCR, etc.) to members
 * Handles duplicates by marking subsequent matches as duplicates
 */
export function matchEntriesToMembers(
  entries: RawEntry[],
  members: MemberRecord[],
  options: { threshold?: number } = {},
): MatchSummary {
  const { threshold = 0.7 } = options;
  const results: MatchResult[] = [];
  const usedMemberIds = new Set<string>();

  for (const entry of entries) {
    if (entry.error || entry.value === undefined) {
      results.push({
        rawName: entry.name,
        rawValue: entry.rawValue,
        sourceRow: entry.sourceRow,
        error: entry.error ?? "Invalid value",
        status: "invalid_value",
        confidence: 0,
      });
      continue;
    }

    const match = findBestMatch(entry.name, members, threshold);

    if (!match) {
      results.push({
        rawName: entry.name,
        value: entry.value,
        rawValue: entry.rawValue,
        sourceRow: entry.sourceRow,
        status: "unmatched",
        confidence: 0,
      });
      continue;
    }

    if (usedMemberIds.has(match.member.id)) {
      results.push({
        rawName: entry.name,
        value: entry.value,
        rawValue: entry.rawValue,
        sourceRow: entry.sourceRow,
        status: "duplicate",
        memberId: match.member.id,
        matchedName: match.member.playerName,
        confidence: match.confidence,
      });
      continue;
    }

    usedMemberIds.add(match.member.id);
    results.push({
      rawName: entry.name,
      value: entry.value,
      rawValue: entry.rawValue,
      sourceRow: entry.sourceRow,
      status: "matched",
      memberId: match.member.id,
      matchedName: match.member.playerName,
      confidence: match.confidence,
    });
  }

  return {
    results,
    matched: results.filter((r) => r.status === "matched").length,
    unmatched: results.filter((r) => r.status === "unmatched").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    total: results.length,
  };
}

/**
 * Strict check to determine if a cell value represents a summary/footer row label
 * (e.g. "Total", "Average", "Grand Total", "Notes:", "Legend:") rather than a player name
 * such as "TotalWar", "AverageJoe", or "SummaryKing".
 */
export function isSummaryFooterRowLabel(cellValue: string): boolean {
  const norm = cellValue.toLowerCase().trim().replace(/\s+/g, " ");
  if (!norm) return false;

  const exactFooterLabels = new Set([
    "total",
    "totals",
    "average",
    "avg",
    "overall",
    "summary",
    "grand total",
    "subtotal",
    "sub-total",
    "alliance total",
    "alliance average",
  ]);
  if (exactFooterLabels.has(norm)) {
    return true;
  }

  if (norm.endsWith(":")) {
    const withoutColon = norm.slice(0, -1).trim();
    const colonFooterKeywords = new Set([
      "total",
      "totals",
      "average",
      "avg",
      "overall",
      "summary",
      "note",
      "notes",
      "legend",
      "comment",
      "comments",
      "grand total",
      "subtotal",
      "sub-total",
      "alliance total",
      "alliance average",
    ]);
    if (colonFooterKeywords.has(withoutColon)) {
      return true;
    }
  }

  const multiWordSummaryRegex =
    /^(total|totals|average|avg|overall|summary|subtotal|sub-total|grand\s+total|alliance\s+total|alliance\s+average)\s+(score|scores|point|points|value|values|count|rows?|stats|statistics|results?|summary|notes?|legend)$/i;

  return multiWordSummaryRegex.test(norm);
}

function isRegionRowEmpty(row: string[] | undefined, startCol: number, endCol: number): boolean {
  if (!row) return true;
  for (let c = startCol; c <= endCol && c < row.length; c++) {
    if (row[c]?.trim()) return false;
  }
  return true;
}

function getRegionFirstNonEmptyCell(row: string[] | undefined, startCol: number, endCol: number): string {
  if (!row) return "";
  for (let c = startCol; c <= endCol && c < row.length; c++) {
    const trimmed = row[c]?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Detect table region bounds (header index, data start, data end) in spreadsheet rows.
 */
export function detectTableBounds(rows: string[][]): TableBoundsResult {
  if (!rows || rows.length === 0) {
    return {
      headerRowIndex: 0,
      dataStartIndex: 0,
      dataEndIndex: 0,
      confidence: "low",
      candidates: [],
      needsConfirmation: true,
      tableRegions: [],
      selectedRegionIndex: 0,
      hasExcludedDataBelow: false,
      excludedRowsCount: 0,
    };
  }

  const candidateRowsLimit = Math.min(15, rows.length);
  const candidates: HeaderCandidate[] = [];

  for (let r = 0; r < candidateRowsLimit; r++) {
    const row = rows[r];
    if (!row || row.every((cell) => !cell.trim())) continue;

    const nonEmptyCells = row.map((c) => c.trim()).filter(Boolean);
    if (nonEmptyCells.length === 0) continue;

    let score = 0;

    for (const cell of row) {
      const trimmed = cell.trim();
      if (!trimmed) continue;

      const norm = normalizeColumnName(trimmed);
      const noSpaces = norm.replace(/\s/g, "");

      if (PLAYER_COLUMN_NAMES.has(norm) || PLAYER_COLUMN_NAMES.has(noSpaces)) {
        score += 15;
      } else if (THP_COLUMN_NAMES.has(norm) || THP_COLUMN_NAMES.has(noSpaces)) {
        score += 8;
      } else if (ROLE_COLUMN_NAMES.has(norm) || ROLE_COLUMN_NAMES.has(noSpaces)) {
        score += 8;
      } else if (POWER_COLUMN_NAMES.has(norm) || POWER_COLUMN_NAMES.has(noSpaces)) {
        score += 8;
      } else if (norm.length > 0 && norm.length <= 30 && !/^\d+$/.test(norm)) {
        score += 1;
      }
    }

    if (nonEmptyCells.length === 1 && (nonEmptyCells[0].length > 25 || r === 0)) {
      score -= 10;
    }

    candidates.push({
      rowIndex: r,
      score,
      sampleHeaders: nonEmptyCells.slice(0, 5),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const headerRowIndex = best ? best.rowIndex : 0;
  const dataStartIndex = headerRowIndex + 1;

  // Detect side-by-side TableRegions in the header row
  const headerRow = rows[headerRowIndex] || [];
  const maxCols = Math.max(...rows.map((r) => r.length), 0);

  const playerCols: { colIndex: number; name: string }[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const cell = headerRow[c]?.trim() || "";
    if (!cell) continue;
    const norm = normalizeColumnName(cell);
    const noSpaces = norm.replace(/\s/g, "");
    if (PLAYER_COLUMN_NAMES.has(norm) || PLAYER_COLUMN_NAMES.has(noSpaces)) {
      playerCols.push({ colIndex: c, name: cell });
    }
  }

  const tableRegions: TableRegion[] = [];

  if (playerCols.length > 1) {
    for (let i = 0; i < playerCols.length; i++) {
      const p = playerCols[i];
      const startColumn = i === 0 ? 0 : playerCols[i].colIndex;
      const endColumn =
        i === playerCols.length - 1
          ? maxCols - 1
          : playerCols[i + 1].colIndex - 1;

      const startLabel = columnIndexToLabel(startColumn);
      const endLabel = columnIndexToLabel(endColumn);

      tableRegions.push({
        id: `region_${i}`,
        name: `Table ${i + 1} (Cols ${startLabel}–${endLabel}: ${p.name})`,
        startColumn,
        endColumn,
        playerColumnIndex: p.colIndex,
        playerColumnName: p.name,
        headerRowIndex,
        dataStartIndex,
        dataEndIndex: rows.length,
        hasExcludedDataBelow: false,
        excludedRowsCount: 0,
      });
    }
  } else {
    const pColIdx = playerCols[0] ? playerCols[0].colIndex : 0;
    const pColName = playerCols[0] ? playerCols[0].name : "Player";
    const startLabel = columnIndexToLabel(0);
    const endLabel = columnIndexToLabel(Math.max(maxCols - 1, 0));

    tableRegions.push({
      id: "region_0",
      name: `Table 1 (Cols ${startLabel}–${endLabel})`,
      startColumn: 0,
      endColumn: Math.max(maxCols - 1, 0),
      playerColumnIndex: pColIdx,
      playerColumnName: pColName,
      headerRowIndex,
      dataStartIndex,
      dataEndIndex: rows.length,
      hasExcludedDataBelow: false,
      excludedRowsCount: 0,
    });
  }

  // Calculate dataEndIndex, excludedRowsCount, and hasExcludedDataBelow for EACH table region independently
  // Spacer row resilience: empty rows do NOT truncate data if valid non-summary data rows exist below!
  tableRegions.forEach((reg) => {
    let regEndIndex = rows.length;

    for (let r = dataStartIndex; r < rows.length; r++) {
      const row = rows[r];
      const isRowEmpty = isRegionRowEmpty(row, reg.startColumn, reg.endColumn);

      if (isRowEmpty) {
        let hasDataBelow = false;
        for (let subR = r + 1; subR < rows.length; subR++) {
          const subRow = rows[subR];
          if (!isRegionRowEmpty(subRow, reg.startColumn, reg.endColumn)) {
            const firstCell = getRegionFirstNonEmptyCell(subRow, reg.startColumn, reg.endColumn);
            if (!isSummaryFooterRowLabel(firstCell)) {
              hasDataBelow = true;
              break;
            }
          }
        }
        if (!hasDataBelow) {
          regEndIndex = r;
          break;
        }
        continue;
      }

      const firstCell = getRegionFirstNonEmptyCell(row, reg.startColumn, reg.endColumn);
      if (isSummaryFooterRowLabel(firstCell)) {
        regEndIndex = r;
        break;
      }
    }

    reg.dataEndIndex = regEndIndex;

    let excludedRowsCount = 0;
    for (let r = regEndIndex; r < rows.length; r++) {
      const row = rows[r];
      if (!isRegionRowEmpty(row, reg.startColumn, reg.endColumn)) {
        excludedRowsCount++;
      }
    }
    reg.excludedRowsCount = excludedRowsCount;
    reg.hasExcludedDataBelow = excludedRowsCount > 0;
  });

  const primaryRegion = tableRegions[0];
  const dataEndIndex = primaryRegion ? primaryRegion.dataEndIndex : rows.length;
  const excludedRowsCount = primaryRegion ? primaryRegion.excludedRowsCount : 0;
  const hasExcludedDataBelow = primaryRegion ? primaryRegion.hasExcludedDataBelow : false;

  let confidence: "high" | "medium" | "low" = "low";
  let needsConfirmation = true;

  if (best && best.score >= 10 && tableRegions.length === 1) {
    confidence = "high";
    needsConfirmation = false;
  } else if (best && best.score >= 5 && tableRegions.length === 1) {
    confidence = "medium";
    needsConfirmation = false;
  } else {
    confidence = tableRegions.length > 1 ? "medium" : "low";
    needsConfirmation = true;
  }

  return {
    headerRowIndex,
    dataStartIndex,
    dataEndIndex,
    confidence,
    candidates,
    needsConfirmation,
    tableRegions,
    selectedRegionIndex: 0,
    hasExcludedDataBelow,
    excludedRowsCount,
  };
}

export type StructuredParseResult = {
  entries: RawEntry[];
  validEntries: ValidMetricEntry[];
  skippedBlankCells: SkippedBlankCell[];
  invalidValueIssues: InvalidValueIssue[];
  missingIdentityIssues: MissingIdentityIssue[];
  unmatchedMemberIssues: UnmatchedMemberIssue[];
  duplicateMemberIssues: DuplicateMemberIssue[];
  errors: string[];
  detectedMetricName: string | null;
  tableBounds: TableBoundsResult;
};

export type MetricParseResult = StructuredParseResult;
export type CSVParseResult = MetricParseResult;

export type MatrixAnalysisResult = {
  columns: ColumnInfo[];
  rowCount: number;
  error: string | null;
  tableBounds: TableBoundsResult;
};

export function columnIndexToLabel(index: number): string {
  let columnNumber = index + 1;
  let label = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return label;
}

export function cellAddress(rowIndex: number, columnIndex: number): string {
  return `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`;
}

export type CSVAnalysisResult = MatrixAnalysisResult;

/**
 * Analyze matrix grid rows (from CSV, XLSX, XLS) to discover columns, table bounds, and types.
 */
export function analyzeRows(
  rows: string[][],
  tableBoundsInput?: TableBoundsResult,
  selectedRegionIndex: number = 0,
): MatrixAnalysisResult {
  if (!rows || rows.length === 0) {
    const emptyBounds = detectTableBounds(rows);
    return { columns: [], rowCount: 0, error: "Spreadsheet is empty", tableBounds: emptyBounds };
  }

  const bounds = tableBoundsInput ?? detectTableBounds(rows);
  const regionIndex =
    selectedRegionIndex >= 0 && selectedRegionIndex < bounds.tableRegions.length
      ? selectedRegionIndex
      : 0;
  const region = bounds.tableRegions[regionIndex];
  const activeEndIndex = region ? region.dataEndIndex : bounds.dataEndIndex;

  if (rows.length < bounds.dataStartIndex + 1) {
    return {
      columns: [],
      rowCount: 0,
      error: "Spreadsheet must have a header row and at least one data row",
      tableBounds: bounds,
    };
  }

  const headerRow = rows[bounds.headerRowIndex];
  if (!headerRow || headerRow.length === 0) {
    return {
      columns: [],
      rowCount: 0,
      error: "No columns found in header row",
      tableBounds: bounds,
    };
  }

  const startCol = region ? region.startColumn : 0;
  const endCol = region ? region.endColumn : headerRow.length - 1;

  const columns: ColumnInfo[] = [];
  for (let index = startCol; index <= Math.min(endCol, headerRow.length - 1); index++) {
    const header = headerRow[index] || "";
    columns.push({
      index,
      name: header.trim() || `Column ${columnIndexToLabel(index)}`,
      isNumeric: true,
      sampleValues: [],
    });
  }

  const columnStats = columns.map(() => ({
    validIntegerCount: 0,
    totalNonEmptyCount: 0,
  }));

  const sampleEndIndex = Math.min(bounds.dataStartIndex + 10, activeEndIndex);
  for (let i = bounds.dataStartIndex; i < sampleEndIndex; i++) {
    const row = rows[i];
    if (!row || isRegionRowEmpty(row, startCol, endCol)) continue;

    for (let j = 0; j < columns.length; j++) {
      const colIdx = columns[j].index;
      const value = row[colIdx]?.trim() || "";
      columns[j].sampleValues.push(value);

      if (value) {
        columnStats[j].totalNonEmptyCount++;
        if (isValidIntegerString(value)) {
          columnStats[j].validIntegerCount++;
        }
      }
    }
  }

  for (let j = 0; j < columns.length; j++) {
    const stats = columnStats[j];
    columns[j].isNumeric =
      stats.validIntegerCount > 0 &&
      stats.validIntegerCount >= stats.totalNonEmptyCount / 2;
  }

  let rowCount = 0;
  for (let i = bounds.dataStartIndex; i < activeEndIndex; i++) {
    const row = rows[i];
    if (row && !isRegionRowEmpty(row, startCol, endCol)) {
      rowCount++;
    }
  }

  const updatedBounds: TableBoundsResult = {
    ...bounds,
    selectedRegionIndex: regionIndex,
    dataEndIndex: activeEndIndex,
    hasExcludedDataBelow: region ? region.hasExcludedDataBelow : bounds.hasExcludedDataBelow,
    excludedRowsCount: region ? region.excludedRowsCount : bounds.excludedRowsCount,
  };

  return { columns, rowCount, error: null, tableBounds: updatedBounds };
}

/**
 * Legacy wrapper for CSV content string analysis.
 */
export function analyzeCSV(content: string): CSVAnalysisResult {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    const emptyBounds = detectTableBounds([]);
    return { columns: [], rowCount: 0, error: "CSV file is empty", tableBounds: emptyBounds };
  }
  const lines = trimmedContent.split(/\r?\n/);
  const rows = lines.map((line) => parseCSVLine(line));
  return analyzeRows(rows);
}

/**
 * Parse matrix grid rows into raw entries and structured diagnostics.
 */
export function parseMetricRows(
  rows: string[][],
  options: {
    nameColumn: number;
    valueColumn: number;
    hasHeader?: boolean;
    tableBounds?: TableBoundsResult;
    metricName?: string;
  },
): StructuredParseResult {
  const { nameColumn, valueColumn, hasHeader = true, tableBounds, metricName } = options;

  if (!rows || rows.length === 0) {
    const bounds = detectTableBounds(rows);
    return {
      entries: [],
      validEntries: [],
      skippedBlankCells: [],
      invalidValueIssues: [],
      missingIdentityIssues: [],
      unmatchedMemberIssues: [],
      duplicateMemberIssues: [],
      errors: ["Spreadsheet is empty"],
      detectedMetricName: null,
      tableBounds: bounds,
    };
  }

  const bounds = tableBounds ?? detectTableBounds(rows);
  const regionIndex = bounds.selectedRegionIndex ?? 0;
  const region = bounds.tableRegions[regionIndex];

  const headerRowIndex = hasHeader ? bounds.headerRowIndex : 0;
  const dataStartIndex = hasHeader ? bounds.dataStartIndex : 0;
  const dataEndIndex = region ? region.dataEndIndex : bounds.dataEndIndex;

  const entries: RawEntry[] = [];
  const validEntries: ValidMetricEntry[] = [];
  const skippedBlankCells: SkippedBlankCell[] = [];
  const invalidValueIssues: InvalidValueIssue[] = [];
  const missingIdentityIssues: MissingIdentityIssue[] = [];
  const unmatchedMemberIssues: UnmatchedMemberIssue[] = [];
  const duplicateMemberIssues: DuplicateMemberIssue[] = [];
  const errors: string[] = [];
  let detectedMetricName: string | null = null;

  if (hasHeader && rows.length > headerRowIndex) {
    const headerRow = rows[headerRowIndex];
    if (headerRow && headerRow.length > valueColumn) {
      detectedMetricName = headerRow[valueColumn]?.trim() || null;
    }
  }

  const mName = metricName || detectedMetricName || `Column ${columnIndexToLabel(valueColumn)}`;

  for (let i = dataStartIndex; i < dataEndIndex; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => !cell.trim())) continue;

    if (row.length <= Math.max(nameColumn, valueColumn)) {
      errors.push(
        `Row ${i + 1}: Not enough columns; expected data through column ${columnIndexToLabel(Math.max(nameColumn, valueColumn))}`,
      );
      continue;
    }

    const name = row[nameColumn]?.trim() || "";
    const rawValue = row[valueColumn]?.trim() || "";
    const address = cellAddress(i, valueColumn);

    if (!name && !rawValue) {
      continue;
    }

    if (!name && rawValue) {
      const nameAddr = cellAddress(i, nameColumn);
      const err = `Missing player name in cell ${nameAddr}`;
      errors.push(`Cell ${nameAddr}: Missing player name for value "${rawValue}" in column ${mName}`);
      missingIdentityIssues.push({
        sourceRow: i + 1,
        columnIndex: valueColumn,
        nameColumnIndex: nameColumn,
        address,
        nameAddress: nameAddr,
        metricName: mName,
        rawValue,
        error: err,
      });
      continue;
    }

    if (name && !rawValue) {
      skippedBlankCells.push({
        sourceRow: i + 1,
        columnIndex: valueColumn,
        address,
        rawName: name,
        metricName: mName,
      });
      continue;
    }

    const parsed = parseStrictInteger(rawValue);
    if (!parsed.success) {
      const errMsg = parsed.error;
      errors.push(`Cell ${address}: Invalid value "${rawValue}" for "${name}": ${errMsg}`);
      invalidValueIssues.push({
        sourceRow: i + 1,
        columnIndex: valueColumn,
        address,
        rawName: name,
        metricName: mName,
        rawValue,
        error: errMsg,
      });
      entries.push({
        name,
        rawValue,
        sourceRow: i + 1,
        error: errMsg,
      });
      continue;
    }

    validEntries.push({
      name,
      value: parsed.value,
      rawValue,
      sourceRow: i + 1,
      columnIndex: valueColumn,
      address,
      metricName: mName,
    });
    entries.push({
      name,
      value: parsed.value,
      rawValue,
      sourceRow: i + 1,
    });
  }

  return {
    entries,
    validEntries,
    skippedBlankCells,
    invalidValueIssues,
    missingIdentityIssues,
    unmatchedMemberIssues,
    duplicateMemberIssues,
    errors,
    detectedMetricName,
    tableBounds: bounds,
  };
}

/**
 * Legacy wrapper for CSV parsing.
 */
export function parseCSV(
  content: string,
  options: {
    nameColumn: number;
    valueColumn: number;
    hasHeader?: boolean;
  },
): CSVParseResult {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    const bounds = detectTableBounds([]);
    return {
      entries: [],
      validEntries: [],
      skippedBlankCells: [],
      invalidValueIssues: [],
      missingIdentityIssues: [],
      unmatchedMemberIssues: [],
      duplicateMemberIssues: [],
      errors: ["CSV file is empty"],
      detectedMetricName: null,
      tableBounds: bounds,
    };
  }
  const lines = trimmedContent.split(/\r?\n/);
  const rows = lines.map((line) => parseCSVLine(line));
  return parseMetricRows(rows, options);
}

type MetricRecord = {
  id: string;
  name: string;
};

export type MetricMatchResult = {
  status: "matched" | "unmatched";
  metricId?: string;
  metricName?: string;
  detectedName: string;
};

/**
 * Match a detected metric name to available metrics using exact matching.
 */
export function matchMetricName(
  detectedName: string,
  metrics: MetricRecord[],
): MetricMatchResult {
  if (!detectedName) {
    return {
      status: "unmatched",
      detectedName: "",
    };
  }

  const normalizedDetected = normalizeName(detectedName);

  for (const metric of metrics) {
    if (normalizeName(metric.name) === normalizedDetected) {
      return {
        status: "matched",
        metricId: metric.id,
        metricName: metric.name,
        detectedName,
      };
    }
  }

  return {
    status: "unmatched",
    detectedName,
  };
}

/**
 * Parse a single CSV line, handling quoted fields
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
