import {
  parseDateHeader,
  type ParsedDateEvidence,
} from "./dateHeaderParser";
import {
  analyzeDerivedColumn,
  type DerivedReason,
} from "./derivedColumnDetector";

export type ColumnPeriodEvidence = {
  columnIndex: number;
  headerAddress?: string; // e.g. "B1"
  headerText: string;
  tableRegionId?: string;
  parsedDate: ParsedDateEvidence | null;
  proposedMetricName: string;
  isDerived: boolean;
  derivedReason: DerivedReason | null;
  excludedByDefault: boolean;
};

export type PeriodMappingProposal = {
  proposalId: string; // client-stable key pre-commit, e.g. "proposal-1"
  groupingKey: string; // e.g. "snapshot:2026-03-29" or "range:2026-03-29..2026-04-13"
  proposedPeriodName: string;
  dateKind: "snapshot" | "range";
  startsAtISO: string; // YYYY-MM-DD
  endsAtISO: string; // YYYY-MM-DD
  confidence: "high" | "medium" | "low";
  columns: ColumnPeriodEvidence[];
  warnings: string[];
};

export type PeriodMappingReview = {
  mode: "multi_period" | "insufficient_evidence" | "declined";
  sheetName: string;
  tableRegionId?: string;
  proposals: PeriodMappingProposal[];
  evidenceSummary: string;
  hasDerivedColumns: boolean;
  excludedDerivedColumnsCount: number;
};

function formatISODate(c: { year?: number; month: number; day: number }): string {
  const y = c.year ?? new Date().getFullYear();
  const m = String(c.month).padStart(2, "0");
  const d = String(c.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MONTH_DISPLAY = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
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

export type BuildPeriodProposalsInput = {
  sheetName: string;
  tableRegionId?: string;
  headers: Array<{
    columnIndex: number;
    headerText: string;
    headerAddress?: string;
    isPlayerColumn?: boolean;
    isNumeric?: boolean;
  }>;
};

export function buildPeriodMappingReview(
  input: BuildPeriodProposalsInput
): PeriodMappingReview {
  const { sheetName, tableRegionId, headers } = input;

  const candidateColumns: ColumnPeriodEvidence[] = [];
  let excludedDerivedColumnsCount = 0;

  for (const h of headers) {
    if (h.isPlayerColumn) continue;

    const derived = analyzeDerivedColumn(h.headerText);
    const dateResult = parseDateHeader(h.headerText, { sheetName });

    if (derived.isDerived) {
      excludedDerivedColumnsCount++;
    }

    const proposedMetricName =
      dateResult.metricStem ||
      h.headerText.replace(/[\(\):,-]/g, " ").replace(/\s+/g, " ").trim() ||
      `Metric Column ${h.columnIndex + 1}`;

    candidateColumns.push({
      columnIndex: h.columnIndex,
      headerAddress: h.headerAddress,
      headerText: h.headerText,
      tableRegionId,
      parsedDate: dateResult.dateEvidence,
      proposedMetricName,
      isDerived: derived.isDerived,
      derivedReason: derived.reason,
      excludedByDefault: derived.isDerived || !dateResult.hasDateEvidence,
    });
  }

  // Group columns with valid date evidence (that are not derived)
  const grouped = new Map<string, ColumnPeriodEvidence[]>();

  for (const col of candidateColumns) {
    if (col.excludedByDefault || !col.parsedDate) continue;

    const startStr = formatISODate(col.parsedDate.start);
    const endStr = formatISODate(col.parsedDate.end);
    const groupingKey = `${col.parsedDate.kind}:${startStr}..${endStr}`;

    if (!grouped.has(groupingKey)) {
      grouped.set(groupingKey, []);
    }
    grouped.get(groupingKey)!.push(col);
  }

  const proposals: PeriodMappingProposal[] = [];
  let proposalCounter = 1;

  for (const [groupingKey, cols] of grouped.entries()) {
    const firstCol = cols[0];
    const dateEvidence = firstCol.parsedDate!;
    const startsAtISO = formatISODate(dateEvidence.start);
    const endsAtISO = formatISODate(dateEvidence.end);
    const proposedPeriodName = generatePeriodName(dateEvidence);

    const warnings: string[] = [];
    cols.forEach((c) => {
      c.parsedDate?.ambiguities.forEach((a) => {
        if (!warnings.includes(a)) warnings.push(a);
      });
    });

    let confidence: "high" | "medium" | "low" = "high";
    if (dateEvidence.yearSource === "sheet_name" || dateEvidence.yearSource === "inferred_default") {
      confidence = "medium";
    }
    if (grouped.size === 1 && cols.length === 1 && dateEvidence.yearSource === "inferred_default") {
      confidence = "low";
    }

    proposals.push({
      proposalId: `proposal-${proposalCounter++}`,
      groupingKey,
      proposedPeriodName,
      dateKind: dateEvidence.kind,
      startsAtISO,
      endsAtISO,
      confidence,
      columns: cols,
      warnings,
    });
  }

  const multiPeriodEligible = proposals.length > 0 && proposals.some((p) => p.confidence !== "low");
  const mode = multiPeriodEligible ? "multi_period" : "insufficient_evidence";

  const totalDateColumns = candidateColumns.filter((c) => c.parsedDate !== null).length;
  const evidenceSummary =
    mode === "multi_period"
      ? `Detected ${totalDateColumns} date-stamped column${totalDateColumns === 1 ? "" : "s"} proposing ${proposals.length} evaluation period${proposals.length === 1 ? "" : "s"} from worksheet "${sheetName}".`
      : `Insufficient date evidence on worksheet "${sheetName}" for multi-period creation.`;

  return {
    mode,
    sheetName,
    tableRegionId,
    proposals,
    evidenceSummary,
    hasDerivedColumns: excludedDerivedColumnsCount > 0,
    excludedDerivedColumnsCount,
  };
}
