import {
  parseDateHeader,
  type ParsedDateEvidence,
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
  | "locale_ambiguous"
  | "unresolved_year"
  | "player_column";

export type ExcludedColumnEvidence = {
  columnIndex: number;
  headerAddress?: string;
  headerText: string;
  tableRegionId?: string;
  reason: ColumnExclusionReason;
  detail: string;
  derivedReason?: DerivedReason;
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

export type PeriodMappingReview = {
  mode: "multi_period" | "insufficient_evidence" | "declined";
  sheetName: string;
  tableRegionId?: string;
  headerRowIndex: number;
  proposals: PeriodMappingProposal[];
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
  const startStr = formatISODate(dateEvidence.start) ?? `??-${dateEvidence.start.month}-${dateEvidence.start.day}`;
  const endStr = formatISODate(dateEvidence.end) ?? `??-${dateEvidence.end.month}-${dateEvidence.end.day}`;
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

  // header year: high only when all eligibility signals are clean
  const hasTypedDateBoost = columns.some((c) => c.hasTypedDateHeader);
  if (hasTypedDateBoost) {
    return "high";
  }

  // Explicit year in header without typed-date metadata is still high
  // when calendar-valid, unambiguous, and numeric (numeric enforced upstream).
  return "high";
}

/**
 * Multi-period mode requires either:
 * - more than one distinct temporal group (proposal), OR
 * - exactly one group at high confidence (explicit year, valid calendar, numeric, unambiguous).
 *
 * A single low/medium-confidence group alone is insufficient — err toward not overclaiming.
 */
function qualifiesForMultiPeriod(proposals: PeriodMappingProposal[]): boolean {
  if (proposals.length === 0) return false;
  if (proposals.length > 1) {
    return proposals.some((p) => p.confidence !== "low");
  }
  return proposals[0].confidence === "high";
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
    const dateResult = parseDateHeader(h.headerText, { sheetName });
    const typedDateMeta = findTypedDateForHeader(headerRowIndex, h.columnIndex, cellDates);

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
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: "locale_ambiguous",
        detail:
          "Date shorthand is locale-ambiguous (e.g. 3/4 could be March 4 or April 3)",
      });
      candidateColumns.push(colEvidence);
      continue;
    }

    if (evidence.yearSource === "unresolved") {
      excludedColumns.push({
        columnIndex: h.columnIndex,
        headerAddress: h.headerAddress,
        headerText: h.headerText,
        tableRegionId,
        reason: "unresolved_year",
        detail: "Year could not be determined; please confirm the year for this period",
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
      c.parsedDate?.ambiguities.forEach((a) => {
        if (!warnings.includes(a)) warnings.push(a);
      });
      if (c.hasTypedDateHeader && c.typedDateFormattedText) {
        const typedNote = `Header cell ${c.headerAddress ?? ""} has Excel typed-date formatting (${c.typedDateFormattedText})`;
        if (!warnings.includes(typedNote)) warnings.push(typedNote);
      }
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

  const mode = qualifiesForMultiPeriod(proposals)
    ? "multi_period"
    : "insufficient_evidence";

  const eligibleColumnCount = candidateColumns.filter((c) => !c.excludedByDefault).length;
  const evidenceSummary =
    mode === "multi_period"
      ? `Detected ${eligibleColumnCount} eligible date-stamped numeric column${eligibleColumnCount === 1 ? "" : "s"} proposing ${proposals.length} evaluation period${proposals.length === 1 ? "" : "s"} from worksheet "${sheetName}"${tableRegionId ? ` (region ${tableRegionId})` : ""}.`
      : proposals.length === 1
        ? `One date-stamped column group detected on "${sheetName}", but confidence is insufficient to declare a multi-period workbook. Confirm dates or use the fixed-period import path.`
        : `Insufficient date evidence on worksheet "${sheetName}" for multi-period detection.`;

  return {
    mode,
    sheetName,
    tableRegionId,
    headerRowIndex,
    proposals,
    excludedColumns,
    evidenceSummary,
    hasDerivedColumns: excludedDerivedColumnsCount > 0,
    excludedDerivedColumnsCount,
  };
}
