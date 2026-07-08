/**
 * Member matching utilities for CSV import, OCR, and other data sources.
 * Decoupled from data source to allow reuse across different import methods.
 */

type MemberRecord = {
  id: string;
  playerName: string;
};

type RawEntry = {
  name: string;
  value: number;
};

export type MatchResult = {
  rawName: string;
  value: number;
  status: "matched" | "unmatched" | "duplicate";
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
 * Match raw entries (from CSV, OCR, etc.) to members
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
    const match = findBestMatch(entry.name, members, threshold);

    if (!match) {
      results.push({
        rawName: entry.name,
        value: entry.value,
        status: "unmatched",
        confidence: 0,
      });
      continue;
    }

    if (usedMemberIds.has(match.member.id)) {
      results.push({
        rawName: entry.name,
        value: entry.value,
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

export type CSVParseResult = {
  entries: RawEntry[];
  errors: string[];
  detectedMetricName: string | null;
};

/**
 * Parse CSV content into raw entries
 * Expects format: name,value (with optional header row)
 * Returns the detected metric name from the header's value column
 */
export function parseCSV(
  content: string,
  options: {
    nameColumn?: number;
    valueColumn?: number;
    hasHeader?: boolean;
  } = {},
): CSVParseResult {
  const { nameColumn = 0, valueColumn = 1, hasHeader = true } = options;
  const lines = content.trim().split(/\r?\n/);
  const entries: RawEntry[] = [];
  const errors: string[] = [];
  let detectedMetricName: string | null = null;

  // Extract metric name from header if present
  if (hasHeader && lines.length > 0) {
    const headerColumns = parseCSVLine(lines[0]);
    if (headerColumns.length > valueColumn) {
      detectedMetricName = headerColumns[valueColumn].trim() || null;
    }
  }

  const startIndex = hasHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const columns = parseCSVLine(line);

    if (columns.length <= Math.max(nameColumn, valueColumn)) {
      errors.push(`Row ${i + 1}: Not enough columns`);
      continue;
    }

    const name = columns[nameColumn].trim();
    const rawValue = columns[valueColumn].trim();

    if (!name) {
      errors.push(`Row ${i + 1}: Empty name`);
      continue;
    }

    const value = parseInt(rawValue, 10);
    if (isNaN(value) || !/^-?\d+$/.test(rawValue)) {
      errors.push(
        `Row ${i + 1}: Invalid or missing value "${rawValue}" for "${name}"`,
      );
      continue;
    }

    entries.push({ name, value });
  }

  return { entries, errors, detectedMetricName };
}

type MetricRecord = {
  id: string;
  name: string;
};

export type MetricMatchResult = {
  status: "matched" | "unmatched";
  metricId?: string;
  metricName?: string;
  confidence: number;
  detectedName: string;
};

/**
 * Match a detected metric name (from CSV header, OCR, etc.) to available metrics
 * Returns the best matching metric if confidence is above threshold
 */
export function matchMetricName(
  detectedName: string,
  metrics: MetricRecord[],
  threshold: number = 0.6,
): MetricMatchResult {
  if (!detectedName) {
    return {
      status: "unmatched",
      confidence: 0,
      detectedName: "",
    };
  }

  let bestMatch: MetricRecord | null = null;
  let bestScore = 0;

  for (const metric of metrics) {
    const score = calculateSimilarity(detectedName, metric.name);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = metric;
    }
  }

  if (bestMatch) {
    return {
      status: "matched",
      metricId: bestMatch.id,
      metricName: bestMatch.name,
      confidence: bestScore,
      detectedName,
    };
  }

  return {
    status: "unmatched",
    confidence: bestScore,
    detectedName,
  };
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
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
