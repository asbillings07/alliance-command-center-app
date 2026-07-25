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
  address: string;
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

export type TableBoundsResult = {
  headerRowIndex: number;
  dataStartIndex: number;
  dataEndIndex: number; // exclusive upper index for rows.slice(dataStartIndex, dataEndIndex)
  confidence: "high" | "medium" | "low";
  candidates: HeaderCandidate[];
  needsConfirmation: boolean;
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

  let confidence: "high" | "medium" | "low" = "low";
  let needsConfirmation = true;

  if (best && best.score >= 10) {
    confidence = "high";
    needsConfirmation = false;
  } else if (best && best.score >= 5) {
    confidence = "medium";
    needsConfirmation = false;
  } else {
    confidence = "low";
    needsConfirmation = true;
  }

  let dataEndIndex = rows.length;
  let consecutiveEmptyRows = 0;
  const summaryPattern = /^(total|totals|average|avg|overall|summary|notes?:|legend:)/i;

  for (let r = dataStartIndex; r < rows.length; r++) {
    const row = rows[r];
    const isRowEmpty = !row || row.every((c) => !c.trim());

    if (isRowEmpty) {
      consecutiveEmptyRows++;
      if (consecutiveEmptyRows >= 2) {
        dataEndIndex = r - 1;
        break;
      }
      continue;
    }

    consecutiveEmptyRows = 0;

    const firstNonEmptyCell = row.find((c) => c.trim())?.trim() || "";
    if (summaryPattern.test(firstNonEmptyCell)) {
      dataEndIndex = r;
      break;
    }
  }

  return {
    headerRowIndex,
    dataStartIndex,
    dataEndIndex,
    confidence,
    candidates,
    needsConfirmation,
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
): MatrixAnalysisResult {
  if (!rows || rows.length === 0) {
    const emptyBounds = detectTableBounds(rows);
    return { columns: [], rowCount: 0, error: "Spreadsheet is empty", tableBounds: emptyBounds };
  }

  const bounds = tableBoundsInput ?? detectTableBounds(rows);

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

  const columns: ColumnInfo[] = headerRow.map((header, index) => ({
    index,
    name: header.trim() || `Column ${index + 1}`,
    isNumeric: true,
    sampleValues: [],
  }));

  const columnStats = headerRow.map(() => ({
    validIntegerCount: 0,
    totalNonEmptyCount: 0,
  }));

  const sampleEndIndex = Math.min(bounds.dataStartIndex + 10, bounds.dataEndIndex);
  for (let i = bounds.dataStartIndex; i < sampleEndIndex; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => !cell.trim())) continue;

    for (let j = 0; j < columns.length; j++) {
      const value = row[j]?.trim() || "";
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
  for (let i = bounds.dataStartIndex; i < bounds.dataEndIndex; i++) {
    const row = rows[i];
    if (row && row.some((cell) => cell.trim().length > 0)) {
      rowCount++;
    }
  }

  return { columns, rowCount, error: null, tableBounds: bounds };
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
  const { nameColumn, valueColumn, hasHeader = true, tableBoundsInput } = options as {
    nameColumn: number;
    valueColumn: number;
    hasHeader?: boolean;
    tableBoundsInput?: TableBoundsResult;
    metricName?: string;
  };

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

  const bounds = options.tableBounds ?? detectTableBounds(rows);
  const headerRowIndex = hasHeader ? bounds.headerRowIndex : 0;
  const dataStartIndex = hasHeader ? bounds.dataStartIndex : 0;
  const dataEndIndex = bounds.dataEndIndex;

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

  const mName = options.metricName || detectedMetricName || `Column ${columnIndexToLabel(valueColumn)}`;

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
      const err = "Missing player name";
      errors.push(`Cell ${cellAddress(i, nameColumn)}: ${err}`);
      missingIdentityIssues.push({
        sourceRow: i + 1,
        columnIndex: valueColumn,
        address,
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
