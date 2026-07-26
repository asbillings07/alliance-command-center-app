import {
  parseDateHeader,
  isValidCalendarDate,
  type ParsedDateEvidence,
  type DateHeaderParseResult,
  type ParsedDateComponent,
} from "./dateHeaderParser";
import {
  analyzeDerivedColumn,
  type DerivedReason,
} from "./derivedColumnDetector";
import type { CellDateMetadata } from "@/app/src/lib/workbookParser";

export type ColumnExclusionReason =
  | "derived"
  | "non_numeric"
  | "no_date_evidence"
  | "invalid_date"
  | "player_column";

export type ReviewableColumnReason = "unresolved_year" | "locale_ambiguous";

export type ExcludedColumnEvidence = {
  columnIndex: number;
  headerAddress?: string;
  headerText: string;
  tableRegionId?: string;
  reason: ColumnExclusionReason;
  detail: string;
  derivedReason?: DerivedReason;
};

export type ReviewableColumnEvidence = {
  columnIndex: number;
  headerAddress?: string;
  headerText: string;
  tableRegionId?: string;
  parsedDate: ParsedDateEvidence;
  proposedMetricName: string;
  reviewReason: ReviewableColumnReason;
  detail: string;
  warnings: string[];
  hasTypedDateHeader: boolean;
  typedDateFormattedText?: string;
};

export type ColumnPeriodEvidence = {
  columnIndex: number;
  headerAddress?: string;
  headerText: string;
  tableRegionId?: string;
  parsedDate: ParsedDateEvidence | null;
  proposedMetricName: string;
  isDerived: boolean;
  derivedReason: DerivedReason | null;
  isNumeric: boolean;
  hasTypedDateHeader: boolean;
  typedDateFormattedText?: string;
  excludedByDefault: boolean;
};

export type PeriodMappingProposal = {
  proposalId: string;
  groupingKey: string;
  proposedPeriodName: string;
  dateKind: "snapshot" | "range";
  startsAtISO: string | null;
  endsAtISO: string | null;
  confidence: "high" | "medium" | "low";
  columns: ColumnPeriodEvidence[];
  warnings: string[];
};

export type PeriodMappingReviewMode =
  | "multi_period"
  | "single_period_suggestion"
  | "insufficient_evidence"
  | "declined";

export type PeriodMappingReview = {
  mode: PeriodMappingReviewMode;
  sheetName: string;
  tableRegionId?: string;
  headerRowIndex: number;
  proposals: PeriodMappingProposal[];
  reviewableColumns: ReviewableColumnEvidence[];
  excludedColumns: ExcludedColumnEvidence[];
  evidenceSummary: string;
  hasDerivedColumns: boolean;
  excludedDerivedColumnsCount: number;
};

function formatISODate(c: { year?: number; month: number; day: number }): string | null {
  if (c.year === undefined) return null;
  const m = String(c.month).padStart(2, "0");
  const d = String(c.day).padStart(2, "0");
  return `${c.year}-${m}-${d}`;
}

const MONTH_DISPLAY = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDisplayDate(c: { year?: number; month: number; day: number }): string {
  const mStr = MONTH_DISPLAY[c.month] || String(c.month);
  return `${mStr} ${c.day}${c.year ? `, ${c.year}` : ""}`;
}

function generatePeriodName(dateEvidence: ParsedDateEvidence): string {
  if (dateEvidence.kind === "snapshot") {
    return `${formatDisplayDate(dateEvidence.start)} Evaluation`;
  }
  const sStr = formatDisplayDate(dateEvidence.start);
  const eStr = formatDisplayDate(dateEvidence.end);
  return `${sStr} – ${eStr} Evaluation`;
}

function groupingKeyForEvidence(dateEvidence: ParsedDateEvidence): string {
  const startStr =
    formatISODate(dateEvidence.start) ??
    `??-${dateEvidence.start.month}-${dateEvidence.start.day}`;
  const endStr =
    formatISODate(dateEvidence.end) ??
    `??-${dateEvidence.end.month}-${dateEvidence.end.day}`;
  return `${dateEvidence.kind}:${startStr}..${endStr}`;
}

function findTypedDateForHeader(
  headerRowIndex: number,
  columnIndex: number,
  cellDates?: Record<string, CellDateMetadata>,
): CellDateMetadata | undefined {
  if (!cellDates) return undefined;
  return Object.values(cellDates).find(
    (meta) =>
      meta.isTypedDate &&
      meta.rowIndex === headerRowIndex &&
      meta.columnIndex === columnIndex,
  );
}

function formatTypedDateLabel(decoded: { year: number; month: number; day: number }): string {
  return `${decoded.year}-${String(decoded.month).padStart(2, "0")}-${String(decoded.day).padStart(2, "0")}`;
}

function weakerYearFromEvidence(evidence: ParsedDateEvidence): number | undefined {
  if (evidence.yearSource === "header" || evidence.yearSource === "sheet_name") {
    return evidence.start.year;
  }
  return undefined;
}

function buildTypedConflictWarning(
  decoded: { year: number; month: number; day: number },
  evidence: ParsedDateEvidence,
  sheetName?: string,
): string | null {
  const weakerYear = weakerYearFromEvidence(evidence);
  if (weakerYear === undefined || weakerYear === decoded.year) {
    return null;
  }

  if (evidence.yearSource === "sheet_name" && sheetName) {
    return `Typed Excel date (${formatTypedDateLabel(decoded)}) disagrees with the year inferred from worksheet name "${sheetName}" (${weakerYear}); using the typed Excel date as authoritative.`;
  }

  if (evidence.yearSource === "header") {
    return `Typed Excel date (${formatTypedDateLabel(decoded)}) disagrees with the year in the header text (${weakerYear}); using the typed Excel date as authoritative.`;
  }

  return null;
}

function calendarValidForEvidence(
  evidence: Pick<ParsedDateEvidence, "kind" | "start" | "end">,
): boolean {
  if (!isValidCalendarDate(evidence.start)) return false;
  if (evidence.kind === "range" && !isValidCalendarDate(evidence.end)) return false;
  return true;
}

/**
 * Typed Excel header metadata represents one concrete calendar date from the
 * workbook's date system. For snapshots, that serial is authoritative for the
 * snapshot date. For ranges, a single typed serial may only correct the start
 * endpoint when its month/day match the typed date — never both endpoints.
 */
function applyTypedDateMetadata(
  dateResult: DateHeaderParseResult,
  typedMeta?: CellDateMetadata,
  options?: { sheetName?: string },
): DateHeaderParseResult {
  if (!typedMeta?.decodedDate || !dateResult.dateEvidence) {
    return dateResult;
  }

  const decoded = typedMeta.decodedDate;
  const evidence = dateResult.dateEvidence;
  const ambiguities = evidence.ambiguities.filter(
    (a) =>
      !a.includes("Year could not be determined") &&
      !a.includes("inferred") &&
      !a.includes("Year missing in header"),
  );

  if (evidence.kind === "range") {
    const startMatchesTyped =
      evidence.start.month === decoded.month && evidence.start.day === decoded.day;

    if (!startMatchesTyped) {
      return dateResult;
    }

    const conflict = buildTypedConflictWarning(decoded, evidence, options?.sheetName);
    if (conflict) ambiguities.push(conflict);

    const start: ParsedDateComponent = {
      month: decoded.month,
      day: decoded.day,
      year: decoded.year,
    };
    const end = { ...evidence.end };

    return {
      ...dateResult,
      dateEvidence: {
        ...evidence,
        start,
        end,
        yearSource: "typed_metadata",
        ambiguities,
        isCalendarValid: calendarValidForEvidence({ kind: "range", start, end }),
      },
    };
  }

  const conflict = buildTypedConflictWarning(decoded, evidence, options?.sheetName);
  if (conflict) {
    ambiguities.push(conflict);
  } else if (evidence.yearSource === "unresolved") {
    ambiguities.push(
      `Year resolved from Excel typed-date cell metadata (${decoded.year})`,
    );
  }

  const start: ParsedDateComponent = {
    month: decoded.month,
    day: decoded.day,
    year: decoded.year,
  };

  return {
    ...dateResult,
    dateEvidence: {
      ...evidence,
      start,
      end: start,
      yearSource: "typed_metadata",
      ambiguities,
      isCalendarValid: calendarValidForEvidence({ kind: "snapshot", start, end: start }),
    },
  };
}

/** Formats reviewable partial date evidence for leader-facing UI. */
export function formatReviewableDateEvidence(parsedDate: ParsedDateEvidence): string {
  const formatComponent = (c: ParsedDateComponent): string => {
    if (c.year !== undefined) {
      return `${c.month}/${c.day}/${c.year}`;
    }
    return `${c.month}/${c.day}`;
  };

  if (parsedDate.kind === "range") {
    const startStr = formatComponent(parsedDate.start);
    const endStr = formatComponent(parsedDate.end);
    const yearUnknown =
      parsedDate.start.year === undefined && parsedDate.end.year === undefined;
    return yearUnknown
      ? `${startStr} – ${endStr} (year unknown)`
      : `${startStr} – ${endStr}`;
  }

  const startStr = formatComponent(parsedDate.start);
  return parsedDate.start.year !== undefined
    ? startStr
    : `${startStr} (year unknown)`;
}

function collectColumnWarnings(
  col: ColumnPeriodEvidence,
): string[] {
  const warnings: string[] = [];
  col.parsedDate?.ambiguities.forEach((a) => {
    if (!warnings.includes(a)) warnings.push(a);
  });
  if (col.hasTypedDateHeader && col.typedDateFormattedText) {
    warnings.push(
      `Header cell ${col.headerAddress ?? ""} has Excel typed-date formatting (${col.typedDateFormattedText})`,
    );
  }
  return warnings;
}

function scoreProposalConfidence(
  dateEvidence: ParsedDateEvidence,
  columns: ColumnPeriodEvidence[],
): "high" | "medium" | "low" {
  if (
    dateEvidence.yearSource === "unresolved" ||
    !dateEvidence.isCalendarValid ||
    dateEvidence.isLocaleAmbiguous ||
    dateEvidence.isReversedRange
  ) {
    return "low";
  }

  if (dateEvidence.yearSource === "sheet_name") {
    return "medium";
  }

  if (dateEvidence.yearSource === "typed_metadata") {
    return "high";
  }

  const hasTypedDateBoost = columns.some((c) => c.hasTypedDateHeader);
  if (hasTypedDateBoost) {
    return "high";
  }

  return "high";
}

function isQualifyingProposal(proposal: PeriodMappingProposal): boolean {
  return proposal.confidence === "high" || proposal.confidence === "medium";
}

/**
 * Multi-period mode requires at least two distinct qualifying temporal groups.
 * Confidence establishes credibility within a group; plurality requires ≥2 groups.
 */
function resolveReviewMode(
  proposals: PeriodMappingProposal[],
): Exclude<PeriodMappingReviewMode, "declined"> {
  const qualifying = proposals.filter(isQualifyingProposal);
  if (qualifying.length >= 2) return "multi_period";
  if (qualifying.length === 1) return "single_period_suggestion";
  return "insufficient_evidence";
}

function buildEvidenceSummary(
  mode: Exclude<PeriodMappingReviewMode, "declined">,
  sheetName: string,
  tableRegionId: string | undefined,
  proposals: PeriodMappingProposal[],
  reviewableColumns: ReviewableColumnEvidence[],
  eligibleColumnCount: number,
): string {
  switch (mode) {
    case "multi_period":
      return `Detected ${eligibleColumnCount} eligible date-stamped numeric column${eligibleColumnCount === 1 ? "" : "s"} proposing ${proposals.filter(isQualifyingProposal).length} evaluation period${proposals.filter(isQualifyingProposal).length === 1 ? "" : "s"} from worksheet "${sheetName}"${tableRegionId ? ` (region ${tableRegionId})` : ""}.`;
    case "single_period_suggestion":
      return `This worksheet appears to represent a single evaluation period (${proposals[0]?.proposedPeriodName ?? "one date group"}). You can continue with the fixed-period import below, or review the suggested date evidence.`;
    default:
      if (reviewableColumns.length > 0) {
        return `Date-stamped columns were detected on "${sheetName}", but none are confident enough to suggest concrete periods yet. Review columns needing year or locale confirmation below.`;
      }
      return `Insufficient date evidence on worksheet "${sheetName}" for period-mapping suggestions.`;
  }
}

export type BuildPeriodProposalsInput = {
  sheetName: string;
  tableRegionId?: string;
  headerRowIndex: number;
  cellDates?: Record<string, CellDateMetadata>;
  headers: Array<{
    columnIndex: number;
    headerText: string;
    headerAddress?: string;
    isPlayerColumn?: boolean;
    isNumeric?: boolean;
  }>;
};

export function buildPeriodMappingReview(
  input: BuildPeriodProposalsInput,
): PeriodMappingReview {
  const { sheetName, tableRegionId, headerRowIndex, cellDates, headers } = input;

  const candidateColumns: ColumnPeriodEvidence[] = [];
  const excludedColumns: ExcludedColumnEvidence[] = [];
  const reviewableColumns: ReviewableColumnEvidence[] = [];
  let excludedDerivedColumnsCount = 0;

  for (const h of headers) {
    if (h.isPlayerColumn) {
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: "player_column",
        detail: "Player/identity column is not a metric results column",
      });
      continue;
    }

    const derived = analyzeDerivedColumn(h.headerText);
    const typedDateMeta = findTypedDateForHeader(headerRowIndex, h.columnIndex, cellDates);
    const dateResult = applyTypedDateMetadata(
      parseDateHeader(h.headerText, { sheetName }),
      typedDateMeta,
      { sheetName },
    );

    if (derived.isDerived) {
      excludedDerivedColumnsCount++;
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: "derived",
        detail: derived.explanation ?? "Derived column excluded from period mapping",
        derivedReason: derived.reason ?? undefined,
      });
    }

    const proposedMetricName =
      dateResult.metricStem ||
      h.headerText.replace(/[\(\):,-]/g, " ").replace(/\s+/g, " ").trim() ||
      `Metric Column ${h.columnIndex + 1}`;

    const colEvidence: ColumnPeriodEvidence = {
      columnIndex: h.columnIndex,
      headerAddress: h.headerAddress,
      headerText: h.headerText,
      tableRegionId,
      parsedDate: dateResult.dateEvidence,
      proposedMetricName,
      isDerived: derived.isDerived,
      derivedReason: derived.reason,
      isNumeric: h.isNumeric === true,
      hasTypedDateHeader: Boolean(typedDateMeta),
      typedDateFormattedText: typedDateMeta?.formattedText,
      excludedByDefault: true,
    };

    if (derived.isDerived) {
      candidateColumns.push(colEvidence);
      continue;
    }

    if (!h.isNumeric) {
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: "non_numeric",
        detail: "Column contains non-numeric values; date-like header alone is insufficient",
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    if (!dateResult.hasDateEvidence || !dateResult.dateEvidence) {
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: dateResult.invalidDateAttempt ? "invalid_date" : "no_date_evidence",
        detail: dateResult.invalidDateAttempt
          ? "Header contains an impossible calendar date"
          : "Header does not contain recognizable date evidence",
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    const evidence = dateResult.dateEvidence;

    if (!evidence.isCalendarValid) {
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: "invalid_date",
        detail: "Header contains an impossible calendar date",
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    if (evidence.isLocaleAmbiguous) {
      reviewableColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        parsedDate: evidence,
        proposedMetricName,
        reviewReason: "locale_ambiguous",
        detail:
          "Date order is locale-ambiguous (e.g. 3/4 or 3/4/2026 could be March 4 or April 3); please confirm",
        warnings: collectColumnWarnings(colEvidence),
        hasTypedDateHeader: Boolean(typedDateMeta),
        typedDateFormattedText: typedDateMeta?.formattedText,
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    if (evidence.yearSource === "unresolved") {
      reviewableColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        parsedDate: evidence,
        proposedMetricName,
        reviewReason: "unresolved_year",
        detail: "Year could not be determined; please confirm the year for this period",
        warnings: collectColumnWarnings(colEvidence),
        hasTypedDateHeader: Boolean(typedDateMeta),
        typedDateFormattedText: typedDateMeta?.formattedText,
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    colEvidence.excludedByDefault = false;
    candidateColumns.push(colEvidence);
  }

  const grouped = new Map<string, ColumnPeriodEvidence[]>();

  for (const col of candidateColumns) {
    if (col.excludedByDefault || !col.parsedDate) continue;

    const key = groupingKeyForEvidence(col.parsedDate);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(col);
  }

  const proposals: PeriodMappingProposal[] = [];
  let proposalCounter = 1;

  for (const [groupingKey, cols] of grouped.entries()) {
    const firstCol = cols[0];
    const dateEvidence = firstCol.parsedDate!;

    const warnings: string[] = [];
    cols.forEach((c) => {
      collectColumnWarnings(c).forEach((w) => {
        if (!warnings.includes(w)) warnings.push(w);
      });
    });

    const confidence = scoreProposalConfidence(dateEvidence, cols);

    proposals.push({
      proposalId: `proposal-${proposalCounter++}`,
      groupingKey,
      proposedPeriodName: generatePeriodName(dateEvidence),
      dateKind: dateEvidence.kind,
      startsAtISO: formatISODate(dateEvidence.start),
      endsAtISO: formatISODate(dateEvidence.end),
      confidence,
      columns: cols,
      warnings,
    });
  }

  proposals.sort((a, b) => {
    const aKey = a.startsAtISO ?? a.groupingKey;
    const bKey = b.startsAtISO ?? b.groupingKey;
    return aKey.localeCompare(bKey);
  });

  const mode = resolveReviewMode(proposals);
  const eligibleColumnCount = candidateColumns.filter((c) => !c.excludedByDefault).length;

  return {
    mode,
    sheetName,
    tableRegionId,
    headerRowIndex,
    proposals,
    reviewableColumns,
    excludedColumns,
    evidenceSummary: buildEvidenceSummary(
      mode,
      sheetName,
      tableRegionId,
      proposals,
      reviewableColumns,
      eligibleColumnCount,
    ),
    hasDerivedColumns: excludedDerivedColumnsCount > 0,
    excludedDerivedColumnsCount,
  };
}
