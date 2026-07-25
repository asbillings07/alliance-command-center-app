/**
 * Pure column classification logic for spreadsheet imports (#221).
 * Evaluates column headers against attached metrics, library metrics, period naming patterns,
 * and standard metric keywords.
 */

import { matchMetricName } from "@/app/src/lib/memberMatcher";
import { normalizeColumnName } from "@/app/src/lib/importConstants";

export type ColumnIntent = "likely_metric" | "likely_period" | "unsure";

export type ClassificationReason =
  | "matches_existing_metric"
  | "matches_library_metric"
  | "matches_period_pattern"
  | "matches_metric_keyword"
  | "ambiguous_name";

export type ColumnClassification = {
  columnIndex: number;
  columnName: string;
  intent: ColumnIntent;
  reason: ClassificationReason;
  confidence: "high" | "medium" | "low";
  needsConfirmation: boolean;
  matchedMetricId?: string;
  matchedMetricName?: string;
};

type MetricOption = {
  id: string;
  name: string;
};

// Recognized metric keywords for auto-suggesting metric creation/mapping
const METRIC_KEYWORDS = new Set([
  "kills",
  "kill",
  "kill points",
  "killpoint",
  "killpoints",
  "total kills",
  "season kills",
  "donations",
  "donation",
  "tech donations",
  "tech donation",
  "alliance tech",
  "thp",
  "total hero power",
  "hero power",
  "power",
  "total power",
  "power score",
  "vs score",
  "vs points",
  "captures",
  "capture",
  "merit",
  "merits",
  "contribution",
  "contributions",
]);

// Period pattern matching:
// - Dates: 7/18, 07/18, 2026-07-18, 07.18.2026
// - Named periods: VS 7, Week 4, Wk 2, W28, Season 5, S5, Battle 3, B2, Round 1, Day 1
const DATE_PATTERN_REGEX = /^(\d{1,4}[\/\.\-\s]\d{1,2}([\/\.\-\s]\d{1,4})?)$/i;
const PERIOD_PATTERN_REGEX = /^(vs|week|wk|w|season|s|battle|b|round|r|day|d)\s*\d+$/i;

/**
 * Classifies a spreadsheet column header against period metrics, library metrics, period patterns, and metric keywords.
 * Evaluation order:
 * 1. matches_existing_metric (high confidence, no confirmation needed)
 * 2. matches_library_metric (high confidence, no confirmation needed)
 * 3. matches_period_pattern (high confidence period, confirmation required)
 * 4. matches_metric_keyword (medium confidence, no confirmation needed)
 * 5. ambiguous_name (low confidence unsure, no confirmation needed - defaults to skip)
 */
export function classifyColumn(params: {
  columnIndex: number;
  columnName: string;
  periodMetrics: MetricOption[];
  libraryMetrics: MetricOption[];
}): ColumnClassification {
  const { columnIndex, columnName, periodMetrics, libraryMetrics } = params;
  const trimmed = columnName.trim();
  const normalized = normalizeColumnName(trimmed);
  const noSpaces = normalized.replace(/\s/g, "");

  // 1. Step 1: Check if matches a metric already attached to current period
  const existingMatch = matchMetricName(trimmed, periodMetrics);
  if (existingMatch.status === "matched" && existingMatch.metricId && existingMatch.metricName) {
    return {
      columnIndex,
      columnName: trimmed,
      intent: "likely_metric",
      reason: "matches_existing_metric",
      confidence: "high",
      needsConfirmation: false,
      matchedMetricId: existingMatch.metricId,
      matchedMetricName: existingMatch.metricName,
    };
  }

  // 2. Step 2: Check if matches an active metric in the alliance library
  const libraryMatch = matchMetricName(trimmed, libraryMetrics);
  if (libraryMatch.status === "matched" && libraryMatch.metricId && libraryMatch.metricName) {
    return {
      columnIndex,
      columnName: trimmed,
      intent: "likely_metric",
      reason: "matches_library_metric",
      confidence: "high",
      needsConfirmation: false,
      matchedMetricId: libraryMatch.metricId,
      matchedMetricName: libraryMatch.metricName,
    };
  }

  // 3. Step 3: Check if matches period/date patterns BEFORE keyword matching
  const isPeriodPattern =
    DATE_PATTERN_REGEX.test(trimmed) ||
    DATE_PATTERN_REGEX.test(normalized) ||
    PERIOD_PATTERN_REGEX.test(trimmed) ||
    PERIOD_PATTERN_REGEX.test(normalized) ||
    PERIOD_PATTERN_REGEX.test(noSpaces);

  if (isPeriodPattern) {
    return {
      columnIndex,
      columnName: trimmed,
      intent: "likely_period",
      reason: "matches_period_pattern",
      confidence: "high",
      needsConfirmation: true,
    };
  }

  // 4. Step 4: Check if matches known metric keywords
  const isKeywordMatch =
    METRIC_KEYWORDS.has(normalized) ||
    METRIC_KEYWORDS.has(noSpaces) ||
    /^(kills?|donations?|thp|power|captures?|merit|contributions?)$/i.test(normalized);

  if (isKeywordMatch) {
    return {
      columnIndex,
      columnName: trimmed,
      intent: "likely_metric",
      reason: "matches_metric_keyword",
      confidence: "medium",
      needsConfirmation: false,
    };
  }

  // 5. Step 5: Ambiguous / Unrecognized column name
  return {
    columnIndex,
    columnName: trimmed,
    intent: "unsure",
    reason: "ambiguous_name",
    confidence: "low",
    needsConfirmation: false,
  };
}
