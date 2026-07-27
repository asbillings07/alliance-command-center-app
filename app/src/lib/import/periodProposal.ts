import {
  parseDateHeader,
  isValidCalendarDate,
  isCrossYearRangePattern,
  computeIsReversedRange,
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

export type ReviewableColumnReason =
  | "unresolved_year"
  | "locale_ambiguous"
  | "range_chronology_conflict";

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
  dateKind: "snapshot" | "range" | "unspecified";
  startsAtISO: string | null;
  endsAtISO: string | null;
  confidence: "high" | "medium" | "low";
  source: "detected" | "manual_fallback" | "unassigned";
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
 * After typed metadata corrects a range start, reconcile the end year using the
 * same cross-year semantics as header parsing when the end year is absent or
 * came from weaker worksheet context — never overwrite an explicit endpoint year.
 */
function reconcileRangeEndAfterTypedStartCorrection(
  start: ParsedDateComponent,
  end: ParsedDateComponent,
  originalEvidence: ParsedDateEvidence,
): {
  end: ParsedDateComponent;
  ambiguities: string[];
  isReversedRange: boolean;
} {
  const ambiguities: string[] = [];
  let reconciledEnd = { ...end };

  if (start.year === undefined) {
    return {
      end: reconciledEnd,
      ambiguities,
      isReversedRange: computeIsReversedRange("range", start, reconciledEnd),
    };
  }

  const canInferEndYear = !originalEvidence.endYearExplicit;

  if (isCrossYearRangePattern(start, reconciledEnd)) {
    const nextYear = start.year + 1;
    if (canInferEndYear && reconciledEnd.year !== nextYear) {
      reconciledEnd = { ...reconciledEnd, year: nextYear };
      ambiguities.push(
        `Range spans a year boundary; end date assigned to ${nextYear}`,
      );
    }
  } else if (canInferEndYear) {
    if (
      reconciledEnd.year === undefined &&
      originalEvidence.yearSource !== "unresolved"
    ) {
      reconciledEnd = { ...reconciledEnd, year: start.year };
      ambiguities.push(
        `Range end year inferred as ${start.year} to match typed Excel start date`,
      );
    } else if (
      reconciledEnd.year !== undefined &&
      reconciledEnd.year !== start.year
    ) {
      reconciledEnd = { ...reconciledEnd, year: start.year };
      ambiguities.push(
        `Range end year normalized to ${start.year} to match typed Excel start date`,
      );
    }
  }

  const isReversedRange = computeIsReversedRange("range", start, reconciledEnd);
  if (isReversedRange) {
    ambiguities.push(
      "Range end date is before start date; verify the intended period window",
    );
  }

  return {
    end: reconciledEnd,
    ambiguities,
    isReversedRange,
  };
}

/**
 * Typed Excel header metadata represents one concrete calendar date from the
 * workbook's date system. For snapshots, that serial is authoritative for the
 * snapshot date. For ranges, a single typed serial may only correct the start
 * endpoint when its month/day match the typed date — never both endpoints.
 * After correcting the start, end-year context and chronological ordering are
 * recomputed (same-year normalization or Dec→Jan cross-year semantics).
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
      !a.includes("Year missing in header") &&
      !a.includes("Range end date is before start date") &&
      !a.includes("Range spans a year boundary"),
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

    const reconciled = reconcileRangeEndAfterTypedStartCorrection(
      start,
      evidence.end,
      evidence,
    );
    ambiguities.push(...reconciled.ambiguities);

    return {
      ...dateResult,
      dateEvidence: {
        ...evidence,
        start,
        end: reconciled.end,
        yearSource: "typed_metadata",
        startYearExplicit: true,
        endYearExplicit: evidence.endYearExplicit,
        ambiguities,
        isCalendarValid: calendarValidForEvidence({
          kind: "range",
          start,
          end: reconciled.end,
        }),
        isReversedRange: reconciled.isReversedRange,
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
      startYearExplicit: true,
      endYearExplicit: true,
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

export function isQualifyingProposal(proposal: PeriodMappingProposal): boolean {
  return (
    proposal.confidence === "high" ||
    proposal.confidence === "medium" ||
    proposal.source === "manual_fallback"
  );
}

export function qualifyingProposals(review: PeriodMappingReview): PeriodMappingProposal[] {
  return review.proposals.filter(isQualifyingProposal);
}

function reviewableToColumnEvidence(col: ReviewableColumnEvidence): ColumnPeriodEvidence {
  return {
    columnIndex: col.columnIndex,
    headerAddress: col.headerAddress,
    headerText: col.headerText,
    tableRegionId: col.tableRegionId,
    parsedDate: col.parsedDate,
    proposedMetricName: col.proposedMetricName,
    isDerived: false,
    derivedReason: null,
    isNumeric: true,
    hasTypedDateHeader: col.hasTypedDateHeader,
    typedDateFormattedText: col.typedDateFormattedText,
    excludedByDefault: false,
  };
}

function excludedNoDateToColumnEvidence(
  col: ExcludedColumnEvidence,
  proposedMetricName: string,
): ColumnPeriodEvidence {
  return {
    columnIndex: col.columnIndex,
    headerAddress: col.headerAddress,
    headerText: col.headerText,
    tableRegionId: col.tableRegionId,
    parsedDate: null,
    proposedMetricName,
    isDerived: false,
    derivedReason: null,
    isNumeric: true,
    hasTypedDateHeader: false,
    excludedByDefault: false,
  };
}

function collectUnassignedColumnEvidence(
  review: PeriodMappingReview,
): ColumnPeriodEvidence[] {
  return [
    ...review.reviewableColumns.map(reviewableToColumnEvidence),
    ...review.excludedColumns
      .filter((col) => col.reason === "no_date_evidence")
      .map((col) =>
        excludedNoDateToColumnEvidence(
          col,
          col.headerText.replace(/[\(\):,-]/g, " ").replace(/\s+/g, " ").trim() ||
            `Metric Column ${col.columnIndex + 1}`,
        ),
      ),
  ];
}

/**
 * When period detection finds insufficient evidence, synthesize one honest
 * manual-fallback proposal from the review's column classification — derived
 * columns stay out; ambiguous/reviewable and no-date numeric columns remain.
 */
export function buildManualFallbackProposal(
  review: PeriodMappingReview,
): PeriodMappingProposal {
  const columns = collectUnassignedColumnEvidence(review);

  return {
    proposalId: "manual-fallback",
    groupingKey: "manual_fallback",
    proposedPeriodName: "",
    dateKind: "unspecified",
    startsAtISO: null,
    endsAtISO: null,
    confidence: "low",
    source: "manual_fallback",
    columns,
    warnings: [],
  };
}

function buildUnassignedColumnsProposal(
  review: PeriodMappingReview,
): PeriodMappingProposal | null {
  const columns = collectUnassignedColumnEvidence(review);
  if (columns.length === 0) {
    return null;
  }

  return {
    proposalId: "unassigned-columns",
    groupingKey: "unassigned_columns",
    proposedPeriodName: "Unassigned columns",
    dateKind: "unspecified",
    startsAtISO: null,
    endsAtISO: null,
    confidence: "low",
    source: "unassigned",
    columns,
    warnings: [
      "These columns lack confident date evidence alongside the detected period groups. Choose a target evaluation period and confirm or exclude each column before import.",
    ],
  };
}

/** Resolve which proposals the guided importer should present for mapping. */
export function resolveImportProposals(review: PeriodMappingReview): PeriodMappingProposal[] {
  if (review.mode === "insufficient_evidence") {
    return [buildManualFallbackProposal(review)];
  }
  const qualifying = qualifyingProposals(review);
  if (qualifying.length === 0) {
    return [buildManualFallbackProposal(review)];
  }
  const unassigned = buildUnassignedColumnsProposal(review);
  return unassigned ? [...qualifying, unassigned] : qualifying;
}

function demoteConfidenceIfRangeInverted(
  confidence: PeriodMappingProposal["confidence"],
  dateEvidence: ParsedDateEvidence,
  startsAtISO: string | null,
  endsAtISO: string | null,
): PeriodMappingProposal["confidence"] {
  if (confidence !== "high" && confidence !== "medium") {
    return confidence;
  }

  if (dateEvidence.kind !== "range") {
    return confidence;
  }

  if (!startsAtISO || !endsAtISO || endsAtISO < startsAtISO) {
    return "low";
  }

  return confidence;
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

    if (
      evidence.kind === "range" &&
      evidence.isReversedRange &&
      evidence.yearSource === "typed_metadata" &&
      typedDateMeta?.decodedDate
    ) {
      reviewableColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        parsedDate: evidence,
        proposedMetricName,
        reviewReason: "range_chronology_conflict",
        detail:
          "Typed Excel start date conflicts with the range end; chronology could not be safely resolved",
        warnings: collectColumnWarnings(colEvidence),
        hasTypedDateHeader: Boolean(typedDateMeta),
        typedDateFormattedText: typedDateMeta?.formattedText,
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    if (
      evidence.kind === "range" &&
      (evidence.start.year === undefined || evidence.end.year === undefined)
    ) {
      reviewableColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        parsedDate: evidence,
        proposedMetricName,
        reviewReason: "unresolved_year",
        detail:
          evidence.end.year === undefined
            ? "Range end year could not be determined; please confirm the period window"
            : "Year could not be determined; please confirm the year for this period",
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

    const startsAtISO = formatISODate(dateEvidence.start);
    const endsAtISO = formatISODate(dateEvidence.end);
    const scoredConfidence = scoreProposalConfidence(dateEvidence, cols);
    const confidence = demoteConfidenceIfRangeInverted(
      scoredConfidence,
      dateEvidence,
      startsAtISO,
      endsAtISO,
    );

    proposals.push({
      proposalId: `proposal-${proposalCounter++}`,
      groupingKey,
      proposedPeriodName: generatePeriodName(dateEvidence),
      dateKind: dateEvidence.kind,
      startsAtISO,
      endsAtISO,
      confidence,
      source: "detected",
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
