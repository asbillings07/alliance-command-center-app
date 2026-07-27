'use client'
import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  analyzeRows,
  parseMetricRows,
  matchEntriesToMembers,
  matchMetricName,
  detectTableBounds,
  isPlayerColumn,
  columnIndexToLabel,
  cellAddress,
  type MatchSummary,
  type ColumnInfo,
  type TableBoundsResult,
  type SkippedBlankCell,
  type InvalidValueIssue,
  type MissingIdentityIssue,
} from "@/app/src/lib/memberMatcher";
import {
  classifyColumn,
  type ColumnClassification,
} from "@/app/src/lib/columnClassifier";
import { TourButton } from "@/app/src/components/client";
import { smartImportTour } from "@/app/src/lib/tours";
import { importMemberMetrics } from "./action";
import {
  parseWorkbookFile,
  ParsedWorkbook,
  WorkbookIssue,
  SpreadsheetParseErrorCode,
} from "@/app/src/lib/workbookParser";
import { SpreadsheetUpload } from "@/app/src/components/spreadsheet/SpreadsheetUpload";
import { WorkbookSheetSelector } from "@/app/src/components/spreadsheet/WorkbookSheetSelector";
import { NumbersExportGuide } from "@/app/src/components/spreadsheet/NumbersExportGuide";
import { WorkbookParseError } from "@/app/src/components/spreadsheet/WorkbookParseError";
import { SpreadsheetDataShapeGuide } from "@/app/src/components/spreadsheet/SpreadsheetDataShapeGuide";
import { ColumnTranslationCard } from "@/app/src/components/spreadsheet/ColumnTranslationCard";
import { SpreadsheetTranslationSummary } from "@/app/src/components/spreadsheet/SpreadsheetTranslationSummary";
import { SourceColumnTranslationsSection } from "@/app/src/components/spreadsheet/SourceColumnTranslationsSection";
import { MetricPreviewAccordion } from "@/app/src/components/spreadsheet/MetricPreviewAccordion";
import { PeriodProposalReview } from "@/app/src/components/spreadsheet/PeriodProposalReview";
import {
  MultiPeriodImportFlow,
} from "@/app/src/components/spreadsheet/MultiPeriodImportFlow";
import type { AlliancePeriodOption } from "@/app/src/lib/import/multiPeriodImportUi";
import {
  type ColumnTarget,
  type ColumnTranslation,
  extractColumnSamples,
  buildPlannedMetricTranslationSummary,
  buildCommittedMetricTranslationSummary,
} from "@/app/src/lib/importTranslation";
import {
  buildPeriodMappingReview,
  type PeriodMappingReview,
} from "@/app/src/lib/import/periodProposal";

type MemberOption = {
  id: string;
  playerName: string;
};

type MetricOption = {
  id: string;
  name: string;
};

type ImportFormProps = {
  periodId: string;
  periodName: string;
  allianceId: string;
  members: MemberOption[];
  metrics: MetricOption[];
  /** Route-period attachable library metrics for single-period import. */
  libraryMetrics: MetricOption[];
  /** Full active alliance metric library for multi-period attachable derivation. */
  allianceLibraryMetrics: MetricOption[];
  alliancePeriods: AlliancePeriodOption[];
  canCreateMetrics: boolean;
  canAttachMetrics: boolean;
  canConfigurePeriods: boolean;
};

type ImportStep = "upload" | "select" | "preview" | "complete";

export type ColumnConfirmationStatus =
  | "unconfirmed"
  | "confirmed_skip"
  | "confirmed_metric";

type ColumnMetricMapping = {
  columnIndex: number;
  columnName: string;
  classification: ColumnClassification;
  target: ColumnTarget;
  confirmationStatus: ColumnConfirmationStatus;
};

type MetricDisposition = "existing" | "attach" | "create";

type MetricImportPreview = {
  columnIndex: number;
  columnName: string;
  displayName: string;
  proposedMetricName: string;
  disposition: MetricDisposition;
  target: ColumnTarget;
  summary: MatchSummary;
  skippedBlankCells: SkippedBlankCell[];
  invalidValueIssues: InvalidValueIssue[];
  missingIdentityIssues: MissingIdentityIssue[];
};

type DuplicateSelections = Record<number, Record<string, number>>;

type WireMapping = Parameters<typeof importMemberMetrics>[0]["mappings"][number];
type ImportResult = Awaited<ReturnType<typeof importMemberMetrics>>;

type ColumnValueIssue = {
  columnName: string;
  error: string;
};

const DISPOSITION_BADGE: Record<MetricDisposition, { label: string; className: string }> = {
  existing: { label: "On period", className: "bg-surface border border-border text-text-secondary" },
  attach: { label: "Add to period", className: "bg-primary/20 border border-primary/40 text-primary-light font-medium" },
  create: { label: "New metric", className: "bg-primary/20 border border-primary/40 text-primary-light font-medium" },
};

function targetToToken(target: ColumnTarget): string {
  switch (target.kind) {
    case "skip": return "";
    case "existing": return `existing:${target.metricId}`;
    case "attach": return `attach:${target.metricId}`;
    case "create": return "create";
  }
}

function tokenToTarget(token: string, columnName: string): ColumnTarget {
  if (token === "") return { kind: "skip" };
  if (token === "create") return { kind: "create", name: columnName };
  const [kind, metricId] = token.split(":");
  if (kind === "existing" && metricId) return { kind: "existing", metricId };
  if (kind === "attach" && metricId) return { kind: "attach", metricId };
  return { kind: "skip" };
}

function toWireTarget(target: ColumnTarget): WireMapping["target"] {
  if (target.kind === "create") return { kind: "create", name: target.name };
  if (target.kind === "existing" || target.kind === "attach") {
    return { kind: "existing", metricId: target.metricId };
  }
  throw new Error("Cannot send a skipped column");
}

function getPreviewEntries(
  preview: MetricImportPreview,
  selections: Record<string, number> | undefined,
): { memberId: string; rawValue: string }[] {
  const selectedIndices = new Set(Object.values(selections ?? {}));
  return preview.summary.results
    .filter((result, index): result is typeof result & { memberId: string; rawValue: string } => {
      if (!result.memberId || result.status === "invalid_value" || !result.rawValue) return false;
      return selectedIndices.has(index);
    })
    .map((r) => ({ memberId: r.memberId, rawValue: r.rawValue }));
}

function formatCellCount(count: number): string {
  return `${count} spreadsheet ${count === 1 ? "cell" : "cells"}`;
}

function summarizeColumns(columnNames: string[]): string {
  const uniqueColumns = [...new Set(columnNames)];
  const visibleColumns = uniqueColumns.slice(0, 3).join(", ");
  const remainingCount = uniqueColumns.length - 3;
  const suffix = remainingCount > 0 ? `, +${remainingCount} more` : "";
  return `${uniqueColumns.length === 1 ? "Column" : "Columns"}: ${visibleColumns}${suffix}`;
}

function WorkbookIssueNotice({
  issues,
  tone,
  columnNameForIssue,
}: {
  issues: WorkbookIssue[];
  tone: "blocking" | "warning";
  columnNameForIssue: (columnIndex: number) => string;
}) {
  if (issues.length === 0) return null;

  const isBlocking = tone === "blocking";
  const styles = isBlocking
    ? "bg-red-50 border-red-300 text-red-900"
    : "bg-amber-50 border-amber-300 text-amber-900";
  const secondaryText = isBlocking ? "text-red-800" : "text-amber-800";

  return (
    <div className={`p-4 border rounded-lg flex flex-col gap-2 ${styles}`}>
      <div>
        <p className="font-semibold">
          {isBlocking
            ? `Fix ${formatCellCount(issues.length)} before importing`
            : `${formatCellCount(issues.length)} will use saved formula values`}
        </p>
        <p className={`text-sm mt-1 ${secondaryText}`}>
          {summarizeColumns(issues.map((issue) => columnNameForIssue(issue.columnIndex)))}
        </p>
      </div>
      <details className={`text-sm ${secondaryText}`}>
        <summary className="cursor-pointer font-medium">View cell details</summary>
        <ul className="list-disc list-inside text-xs mt-2 max-h-32 overflow-y-auto space-y-0.5">
          {issues.map((issue, idx) => (
            <li key={idx}>
              <strong>{columnNameForIssue(issue.columnIndex)}</strong>
              {issue.address ? ` (${issue.address})` : ""}: {issue.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ValueIssueNotice({
  issues,
  phase,
}: {
  issues: ColumnValueIssue[];
  phase: "preview" | "import";
}) {
  if (issues.length === 0) return null;

  return (
    <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger flex flex-col gap-2">
      <div>
        <p className="font-semibold text-danger">Fix {formatCellCount(issues.length)} before {phase === "preview" ? "previewing" : "importing"}</p>
        <p className="text-sm text-text-secondary mt-1">
          {summarizeColumns(issues.map((issue) => issue.columnName))}. Check cell details below.
        </p>
      </div>
      <details className="text-sm text-text-secondary">
        <summary className="cursor-pointer font-medium text-text-primary select-none">View cell details</summary>
        <ul className="text-xs list-disc list-inside mt-2 max-h-32 overflow-y-auto space-y-0.5 font-mono">
          {issues.map((issue, i) => (
            <li key={i}>
              <strong>{issue.columnName}</strong>: {issue.error}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function ImportForm({ periodId, periodName, allianceId, members, metrics, libraryMetrics, allianceLibraryMetrics, alliancePeriods, canCreateMetrics, canAttachMetrics, canConfigurePeriods }: ImportFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<ImportStep>("upload");
  const [multiPeriodFlowActive, setMultiPeriodFlowActive] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showNumbersGuide, setShowNumbersGuide] = useState(false);
  const [parseErrorCode, setParseErrorCode] = useState<SpreadsheetParseErrorCode | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);

  const [rowCount, setRowCount] = useState(0);
  const [tableBounds, setTableBounds] = useState<TableBoundsResult | null>(null);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);
  const [isHeaderConfirmed, setIsHeaderConfirmed] = useState(false);
  const [selectedHeaderRowIndex, setSelectedHeaderRowIndex] = useState(0);
  const [autoDetectedPlayerColumn, setAutoDetectedPlayerColumn] = useState<ColumnInfo | null>(null);
  const [numericColumns, setNumericColumns] = useState<ColumnInfo[]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMetricMapping[]>([]);
  const [previews, setPreviews] = useState<MetricImportPreview[]>([]);
  const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelections>({});
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [periodProposalReview, setPeriodProposalReview] = useState<PeriodMappingReview | null>(null);
  const [declinedMultiPeriod, setDeclinedMultiPeriod] = useState<boolean>(false);
  const [dismissedPeriodSuggestion, setDismissedPeriodSuggestion] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const metricNameById = useMemo(() => {
    const map = new Map<string, string>();
    [...metrics, ...libraryMetrics].forEach((m) => map.set(m.id, m.name));
    return map;
  }, [metrics, libraryMetrics]);

  const noSelectableMetrics =
    metrics.length === 0 && libraryMetrics.length === 0 && !canCreateMetrics;

  const mappedColumns = columnMappings.filter((m) => m.target.kind !== "skip");

  const handleFileSelected = async (file: File) => {
    setError(null);
    setParseErrorCode(null);
    setParseErrors([]);
    setIsLoadingFile(true);

    try {
      const parseResult = await parseWorkbookFile(file);
      setIsLoadingFile(false);

      if (parseResult.kind === "numbers_export_required") {
        setShowNumbersGuide(true);
        return;
      }

      if (parseResult.kind === "error") {
        setParseErrorCode(parseResult.code);
        setError(parseResult.message);
        return;
      }

      setParsedWorkbook(parseResult.workbook);
      setSelectedSheetIndex(parseResult.workbook.defaultSheetIndex);
      setIsHeaderConfirmed(false);
      analyzeWorkbookSheet(parseResult.workbook, parseResult.workbook.defaultSheetIndex, 0);
    } catch {
      setIsLoadingFile(false);
      setError("An unexpected error occurred while reading the file.");
    }
  };

  const analyzeWorkbookSheet = (
    workbook: ParsedWorkbook,
    sheetIndex: number,
    regionIndex: number = 0,
    overrideHeaderRowIndex?: number,
  ) => {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet || sheet.rows.length === 0) {
      setRowCount(0);
      setTableBounds(null);
      setAutoDetectedPlayerColumn(null);
      setNumericColumns([]);
      setColumnMappings([]);
      setPreviews([]);
      setParseErrors([]);
      setError("The selected worksheet is empty.");
      return;
    }

    let bounds = detectTableBounds(sheet.rows);
    if (overrideHeaderRowIndex !== undefined && overrideHeaderRowIndex >= 0) {
      bounds = {
        ...bounds,
        headerRowIndex: overrideHeaderRowIndex,
        dataStartIndex: overrideHeaderRowIndex + 1,
      };
    }
    setTableBounds(bounds);
    setSelectedHeaderRowIndex(bounds.headerRowIndex);
    setSelectedRegionIndex(regionIndex);

    const result = analyzeRows(sheet.rows, bounds, regionIndex);
    if (result.tableBounds) {
      bounds = result.tableBounds;
      setTableBounds(bounds);
    }
    if (result.error) {
      setRowCount(0);
      setAutoDetectedPlayerColumn(null);
      setNumericColumns([]);
      setColumnMappings([]);
      setPreviews([]);
      setParseErrors([]);
      setError(result.error);
      return;
    }
    if (result.columns.length < 2) {
      setRowCount(0);
      setAutoDetectedPlayerColumn(null);
      setNumericColumns([]);
      setColumnMappings([]);
      setPreviews([]);
      setParseErrors([]);
      setError("Worksheet must have at least 2 columns in selected region");
      return;
    }

    const textCols = result.columns.filter((c) => !c.isNumeric);
    const selectedRegion = bounds.tableRegions[regionIndex] || bounds.tableRegions[0];
    const playerColIdx = selectedRegion ? selectedRegion.playerColumnIndex : -1;
    const playerCol =
      result.columns.find((c) => c.index === playerColIdx) ||
      textCols.find((c) => isPlayerColumn(c.name)) ||
      textCols[0] ||
      null;

    const numCols = result.columns.filter((c) => c.isNumeric && c.index !== playerCol?.index);

    const usedMetricIds = new Set<string>();
    const mappings: ColumnMetricMapping[] = numCols.map((col) => {
      const classification = classifyColumn({
        columnIndex: col.index,
        columnName: col.name,
        periodMetrics: metrics,
        libraryMetrics,
      });

      if (
        classification.reason === "matches_existing_metric" &&
        classification.matchedMetricId &&
        !usedMetricIds.has(classification.matchedMetricId)
      ) {
        usedMetricIds.add(classification.matchedMetricId);
        return {
          columnIndex: col.index,
          columnName: col.name,
          classification,
          target: { kind: "existing", metricId: classification.matchedMetricId },
          confirmationStatus: "confirmed_metric",
        };
      }

      if (
        classification.reason === "matches_library_metric" &&
        classification.matchedMetricId &&
        canAttachMetrics &&
        !usedMetricIds.has(classification.matchedMetricId)
      ) {
        usedMetricIds.add(classification.matchedMetricId);
        return {
          columnIndex: col.index,
          columnName: col.name,
          classification,
          target: { kind: "attach", metricId: classification.matchedMetricId },
          confirmationStatus: "confirmed_metric",
        };
      }

      if (classification.reason === "matches_period_pattern") {
        return {
          columnIndex: col.index,
          columnName: col.name,
          classification,
          target: { kind: "skip" },
          confirmationStatus: "unconfirmed",
        };
      }

      if (classification.reason === "matches_metric_keyword") {
        if (canCreateMetrics) {
          return {
            columnIndex: col.index,
            columnName: col.name,
            classification,
            target: { kind: "create", name: col.name },
            confirmationStatus: "confirmed_metric",
          };
        }
      }

      return {
        columnIndex: col.index,
        columnName: col.name,
        classification,
        target: { kind: "skip" },
        confirmationStatus: "unconfirmed",
      };
    });

    const proposalReview = buildPeriodMappingReview({
      sheetName: sheet.name,
      tableRegionId: selectedRegion?.id,
      headerRowIndex: bounds.headerRowIndex,
      cellDates: sheet.cellDates,
      headers: result.columns.map((c) => ({
        columnIndex: c.index,
        headerText: c.name,
        headerAddress: cellAddress(bounds.headerRowIndex, c.index),
        isPlayerColumn: playerCol?.index === c.index,
        isNumeric: c.isNumeric,
      })),
    });

    setRowCount(result.rowCount);
    setAutoDetectedPlayerColumn(playerCol);
    setNumericColumns(numCols);
    setColumnMappings(mappings);
    setPeriodProposalReview(proposalReview);
    setDeclinedMultiPeriod(false);
    setDismissedPeriodSuggestion(false);
    setError(null);
    setStep("select");
  };

  const handleSelectRegion = (regionIdx: number) => {
    if (!parsedWorkbook) return;
    setSelectedRegionIndex(regionIdx);
    analyzeWorkbookSheet(parsedWorkbook, selectedSheetIndex, regionIdx, selectedHeaderRowIndex);
  };

  const handleSelectHeaderRow = (headerRowIdx: number) => {
    if (!parsedWorkbook) return;
    setSelectedHeaderRowIndex(headerRowIdx);
    analyzeWorkbookSheet(parsedWorkbook, selectedSheetIndex, selectedRegionIndex, headerRowIdx);
  };

  const handleSelectSheet = (sheetIndex: number) => {
    if (!parsedWorkbook) return;
    setSelectedSheetIndex(sheetIndex);
    setError(null);
    setPreviews([]);
    setParseErrors([]);
    analyzeWorkbookSheet(parsedWorkbook, sheetIndex);
  };

  const displayNameFor = (target: ColumnTarget, columnName: string): string => {
    if (target.kind === "existing" || target.kind === "attach") {
      return metricNameById.get(target.metricId) ?? columnName;
    }
    if (target.kind === "create") return target.name;
    return columnName;
  };

  const rebuildPreviews = (
    newMappings: ColumnMetricMapping[],
    currentSelections: DuplicateSelections = duplicateSelections,
  ): MetricImportPreview[] => {
    if (!autoDetectedPlayerColumn || !parsedWorkbook) return [];

    const currentSheet = parsedWorkbook.sheets[selectedSheetIndex];
    if (!currentSheet) return [];

    const mapped = newMappings.filter((m) => m.target.kind !== "skip");
    if (mapped.length === 0) {
      setPreviews([]);
      setStep("select");
      setError("All columns were skipped. Map at least one column to preview import.");
      return [];
    }

    const nextPreviews: MetricImportPreview[] = [];
    const nextSelections: DuplicateSelections = {};
    const aggregatedErrors: string[] = [];

    for (const mapping of mapped) {
      const metricDisplayName = displayNameFor(mapping.target, mapping.columnName);
      const parseResult = parseMetricRows(currentSheet.rows, {
        nameColumn: autoDetectedPlayerColumn.index,
        valueColumn: mapping.columnIndex,
        hasHeader: true,
        tableBounds: tableBounds ?? undefined,
        metricName: metricDisplayName,
      });

      parseResult.errors.forEach((err) => aggregatedErrors.push(`${mapping.columnName}: ${err}`));

      const summary = matchEntriesToMembers(parseResult.entries, members);
      const selections: Record<string, number> = currentSelections[mapping.columnIndex]
        ? { ...currentSelections[mapping.columnIndex] }
        : {};

      summary.results.forEach((result, index) => {
        if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
          if (!(result.memberId in selections)) selections[result.memberId] = index;
        }
      });

      nextPreviews.push({
        columnIndex: mapping.columnIndex,
        columnName: mapping.columnName,
        displayName: metricDisplayName,
        proposedMetricName: mapping.columnName,
        disposition: mapping.target.kind === "skip" ? "existing" : mapping.target.kind,
        target: mapping.target,
        summary,
        skippedBlankCells: parseResult.skippedBlankCells,
        invalidValueIssues: parseResult.invalidValueIssues,
        missingIdentityIssues: parseResult.missingIdentityIssues,
      });
      nextSelections[mapping.columnIndex] = selections;
    }

    setPreviews(nextPreviews);
    setDuplicateSelections(nextSelections);
    setParseErrors(aggregatedErrors);
    return nextPreviews;
  };

  const updateColumnMappings = (
    updater: (prev: ColumnMetricMapping[]) => ColumnMetricMapping[],
  ) => {
    setError(null);
    setColumnMappings((prev) => {
      const updated = updater(prev);
      if (step === "preview") {
        rebuildPreviews(updated);
      }
      return updated;
    });
  };

  const setColumnTarget = (columnIndex: number, token: string, columnName: string) => {
    updateColumnMappings((prev) =>
      prev.map((m) => {
        if (m.columnIndex !== columnIndex) return m;
        const target = tokenToTarget(token, columnName);
        const confirmationStatus: ColumnConfirmationStatus =
          target.kind === "skip" ? "confirmed_skip" : "confirmed_metric";
        return {
          ...m,
          target,
          confirmationStatus,
        };
      }),
    );
  };

  const handleConfirmPeriodColumnAsMetric = (columnIndex: number, columnName: string) => {
    // Try existing metric first
    const onPeriod = matchMetricName(columnName, metrics);
    if (onPeriod.status === "matched" && onPeriod.metricId) {
      const metricId = onPeriod.metricId;
      updateColumnMappings((prev) =>
        prev.map((m) =>
          m.columnIndex === columnIndex
            ? { ...m, target: { kind: "existing", metricId }, confirmationStatus: "confirmed_metric" }
            : m,
        ),
      );
      return;
    }

    if (canAttachMetrics) {
      const inLibrary = matchMetricName(columnName, libraryMetrics);
      if (inLibrary.status === "matched" && inLibrary.metricId) {
        const metricId = inLibrary.metricId;
        updateColumnMappings((prev) =>
          prev.map((m) =>
            m.columnIndex === columnIndex
              ? { ...m, target: { kind: "attach", metricId }, confirmationStatus: "confirmed_metric" }
              : m,
          ),
        );
        return;
      }
    }

    if (canCreateMetrics) {
      updateColumnMappings((prev) =>
        prev.map((m) =>
          m.columnIndex === columnIndex
            ? { ...m, target: { kind: "create", name: columnName }, confirmationStatus: "confirmed_metric" }
            : m,
        ),
      );
      return;
    }

    setError(
      `Creating a new metric for "${columnName}" requires metric configuration permission. Please select an existing metric or skip the column.`,
    );
  };

  const handleConfirmColumnAsSkip = (columnIndex: number) => {
    updateColumnMappings((prev) =>
      prev.map((m) =>
        m.columnIndex === columnIndex
          ? { ...m, target: { kind: "skip" }, confirmationStatus: "confirmed_skip" }
          : m,
      ),
    );
  };

  const handleSelectComplete = () => {
    if (!autoDetectedPlayerColumn || mappedColumns.length === 0 || !parsedWorkbook) return;

    const currentSheet = parsedWorkbook.sheets[selectedSheetIndex];
    if (!currentSheet) return;

    const nextPreviews: MetricImportPreview[] = [];
    const nextSelections: DuplicateSelections = {};
    const aggregatedErrors: string[] = [];

    for (const mapping of mappedColumns) {
      const metricDisplayName = displayNameFor(mapping.target, mapping.columnName);
      const parseResult = parseMetricRows(currentSheet.rows, {
        nameColumn: autoDetectedPlayerColumn.index,
        valueColumn: mapping.columnIndex,
        hasHeader: true,
        tableBounds: tableBounds ?? undefined,
        metricName: metricDisplayName,
      });

      parseResult.errors.forEach((err) => aggregatedErrors.push(`${mapping.columnName}: ${err}`));

      const summary = matchEntriesToMembers(parseResult.entries, members);
      const selections: Record<string, number> = {};
      summary.results.forEach((result, index) => {
        if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
          if (!(result.memberId in selections)) selections[result.memberId] = index;
        }
      });

      nextPreviews.push({
        columnIndex: mapping.columnIndex,
        columnName: mapping.columnName,
        displayName: metricDisplayName,
        proposedMetricName: mapping.columnName,
        disposition: mapping.target.kind === "skip" ? "existing" : mapping.target.kind,
        target: mapping.target,
        summary,
        skippedBlankCells: parseResult.skippedBlankCells,
        invalidValueIssues: parseResult.invalidValueIssues,
        missingIdentityIssues: parseResult.missingIdentityIssues,
      });
      nextSelections[mapping.columnIndex] = selections;
    }

    const totalParsed = nextPreviews.reduce((sum, p) => sum + p.summary.total, 0);
    const totalMatched = nextPreviews.reduce(
      (sum, p) => sum + getPreviewEntries(p, nextSelections[p.columnIndex]).length,
      0,
    );
    const totalSkippedBlanksInSelect = nextPreviews.reduce(
      (sum, p) => sum + p.skippedBlankCells.length,
      0,
    );
    const totalMissingIdentityCount = nextPreviews.reduce(
      (sum, p) => sum + p.missingIdentityIssues.length,
      0,
    );
    const totalInvalidValueCount = nextPreviews.reduce(
      (sum, p) => sum + p.invalidValueIssues.length,
      0,
    );

    if (totalMatched === 0 || totalMissingIdentityCount > 0 || totalInvalidValueCount > 0) {
      if (totalMissingIdentityCount > 0) {
        setError(
          `Cannot import: ${totalMissingIdentityCount} ${totalMissingIdentityCount === 1 ? "cell contains" : "cells contain"} metric values but missing player names. Check player column.`,
        );
      } else if (totalInvalidValueCount > 0) {
        setError(
          `Cannot import: ${totalInvalidValueCount} ${totalInvalidValueCount === 1 ? "cell contains" : "cells contain"} invalid non-whole-number values.`,
        );
      } else if (totalParsed === 0 && totalSkippedBlanksInSelect > 0) {
        setError(
          `No importable values found. ${totalSkippedBlanksInSelect} blank metric ${totalSkippedBlanksInSelect === 1 ? "cell was" : "cells were"} skipped.`,
        );
      } else if (totalParsed === 0) {
        setError(
          "No valid values found to import. Check the mapped columns.",
        );
      } else {
        setError(
          "No rows matched any of your alliance members. Check the player names and try again.",
        );
      }
      return;
    }

    setPreviews(nextPreviews);
    setDuplicateSelections(nextSelections);
    setParseErrors(aggregatedErrors);
    setError(null);
    setStep("preview");
  };

  const handleDuplicateSelection = (columnIndex: number, memberId: string, resultIndex: number) => {
    setDuplicateSelections((prev) => ({
      ...prev,
      [columnIndex]: { ...(prev[columnIndex] ?? {}), [memberId]: resultIndex },
    }));
  };

  const totalToImport = useMemo(
    () => previews.reduce((sum, p) => sum + getPreviewEntries(p, duplicateSelections[p.columnIndex]).length, 0),
    [previews, duplicateSelections],
  );

  const totalSkippedBlanks = useMemo(
    () => previews.reduce((sum, p) => sum + p.skippedBlankCells.length, 0),
    [previews],
  );

  const currentSheet = parsedWorkbook?.sheets[selectedSheetIndex];
  const mappedIndicesSet = new Set(
    [
      autoDetectedPlayerColumn?.index,
      ...mappedColumns.map((m) => m.columnIndex),
    ].filter((idx): idx is number => idx !== null && idx !== undefined)
  );

  const blockingCellIssues: WorkbookIssue[] = [];
  const warningCellIssues: WorkbookIssue[] = [];

  const activeDataStart = tableBounds ? tableBounds.dataStartIndex : 0;
  const activeDataEnd = tableBounds ? tableBounds.dataEndIndex : (currentSheet?.rows.length ?? 0);
  const selectedRegion = tableBounds?.tableRegions[selectedRegionIndex] || tableBounds?.tableRegions[0];
  const activeStartCol = selectedRegion ? selectedRegion.startColumn : 0;
  const activeEndCol = selectedRegion ? selectedRegion.endColumn : 999;

  if (currentSheet && currentSheet.issues) {
    for (const issue of currentSheet.issues) {
      if (!mappedIndicesSet.has(issue.columnIndex)) continue;
      if (issue.rowIndex < activeDataStart || issue.rowIndex >= activeDataEnd) continue;
      if (issue.columnIndex < activeStartCol || issue.columnIndex > activeEndCol) continue;

      if (issue.severity === "blocking" || issue.code === "formula_missing_cached_value" || issue.code === "cell_error") {
        blockingCellIssues.push(issue);
      } else if (issue.severity === "warning") {
        warningCellIssues.push(issue);
      }
    }
  }

  const columnNameByIndex = new Map<number, string>();
  currentSheet?.rows[0]?.forEach((header, index) => {
    columnNameByIndex.set(index, header.trim() || `Column ${index + 1}`);
  });
  numericColumns.forEach((column) => columnNameByIndex.set(column.index, column.name));
  columnMappings.forEach((mapping) => columnNameByIndex.set(mapping.columnIndex, mapping.columnName));
  if (autoDetectedPlayerColumn) {
    columnNameByIndex.set(autoDetectedPlayerColumn.index, autoDetectedPlayerColumn.name);
  }
  const columnNameForIssue = (columnIndex: number) => columnNameByIndex.get(columnIndex) ?? `Column ${columnIndex + 1}`;

  const valueIssuesBeforePreview: ColumnValueIssue[] = [];
  if (currentSheet && autoDetectedPlayerColumn) {
    for (const mapping of mappedColumns) {
      const parseRes = parseMetricRows(currentSheet.rows, {
        nameColumn: autoDetectedPlayerColumn.index,
        valueColumn: mapping.columnIndex,
        hasHeader: true,
        tableBounds: tableBounds ?? undefined,
        metricName: displayNameFor(mapping.target, mapping.columnName),
      });
      parseRes.invalidValueIssues.forEach((issue) =>
        valueIssuesBeforePreview.push({ columnName: issue.metricName, error: `${issue.address}: ${issue.error}` }),
      );
      parseRes.missingIdentityIssues.forEach((issue) =>
        valueIssuesBeforePreview.push({ columnName: issue.metricName, error: `${issue.address} (Value "${issue.rawValue}"): ${issue.error}` }),
      );
    }
  }

  const hasBlockingDiagnostics = blockingCellIssues.length > 0;
  const hasValueIssuesBeforePreview = valueIssuesBeforePreview.length > 0;

  const columnTranslations: ColumnTranslation[] = useMemo(() => {
    if (!currentSheet || !tableBounds) return [];
    const row0 = currentSheet.rows[tableBounds.headerRowIndex] ?? [];
    const totalCols = row0.length;
    const playerColIdx = autoDetectedPlayerColumn?.index ?? -1;

    const mappingByColIndex = new Map(columnMappings.map((m) => [m.columnIndex, m]));

    const translations: ColumnTranslation[] = [];
    for (let c = 0; c < totalCols; c++) {
      const headerName = row0[c]?.trim() || `Column ${columnIndexToLabel(c)}`;
      const samples = extractColumnSamples(
        currentSheet.rows,
        c,
        tableBounds.dataStartIndex,
        tableBounds.dataEndIndex
      );

      if (c === playerColIdx) {
        translations.push({
          kind: "identity",
          sourceColumnName: headerName,
          columnIndex: c,
          samples,
          targetLabel: "Member Identity",
          status: "mapped",
        });
        continue;
      }

      const mapping = mappingByColIndex.get(c);
      if (mapping) {
        translations.push({
          kind: "metric",
          sourceColumnName: headerName,
          columnIndex: c,
          samples,
          target: mapping.target,
          classification: mapping.classification,
          confirmationStatus: mapping.confirmationStatus,
          status:
            mapping.target.kind === "skip"
              ? mapping.confirmationStatus === "unconfirmed"
                ? "unconfirmed"
                : "skipped"
              : "mapped",
        });
        continue;
      }

      if (samples.length === 0) {
        translations.push({
          kind: "empty",
          sourceColumnName: headerName,
          columnIndex: c,
          samples: [],
          reason: "No values in column",
          status: "ignored",
        });
      } else {
        translations.push({
          kind: "unsupported",
          sourceColumnName: headerName,
          columnIndex: c,
          samples,
          reason: "Free-form text / unsupported non-numeric column",
          status: "excluded",
        });
      }
    }
    return translations;
  }, [currentSheet, tableBounds, autoDetectedPlayerColumn, columnMappings]);

  const handleImport = () => {
    const mappings: WireMapping[] = previews
      .map((preview) => ({
        sourceColumnName: preview.columnName,
        target: toWireTarget(preview.target),
        entries: getPreviewEntries(preview, duplicateSelections[preview.columnIndex]),
      }))
      .filter((m) => m.entries.length > 0);

    if (mappings.length === 0) {
      setError("No matched entries to import");
      return;
    }

    startTransition(async () => {
      try {
        const result = await importMemberMetrics({ periodId, allianceId, mappings });
        setImportResult(result);
        router.refresh();
        setStep("complete");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });
  };

  const handleReset = () => {
    setStep("upload");
    setParseErrorCode(null);
    setParsedWorkbook(null);
    setRowCount(0);
    setTableBounds(null);
    setAutoDetectedPlayerColumn(null);
    setNumericColumns([]);
    setColumnMappings([]);
    setPreviews([]);
    setDuplicateSelections({});
    setParseErrors([]);
    setError(null);
    setImportResult(null);
    setMultiPeriodFlowActive(false);
  };

  const handleBack = () => {
    if (step === "select") {
      handleReset();
    } else if (step === "preview") {
      setStep("select");
      setPreviews([]);
      setParseErrors([]);
      setError(null);
    }
  };

  // Multi-period mapping flow (PR 2)
  if (
    multiPeriodFlowActive &&
    periodProposalReview &&
    parsedWorkbook &&
    autoDetectedPlayerColumn &&
    step === "select"
  ) {
    return (
      <MultiPeriodImportFlow
        allianceId={allianceId}
        routePeriodId={periodId}
        alliancePeriods={alliancePeriods}
        allianceLibraryMetrics={allianceLibraryMetrics}
        canCreateMetrics={canCreateMetrics}
        canAttachMetrics={canAttachMetrics}
        canConfigurePeriods={canConfigurePeriods}
        members={members}
        review={periodProposalReview}
        parsedWorkbook={parsedWorkbook}
        selectedSheetIndex={selectedSheetIndex}
        tableBounds={tableBounds}
        playerColumnIndex={autoDetectedPlayerColumn.index}
        onCancel={() => setMultiPeriodFlowActive(false)}
      />
    );
  }

  // Complete step
  if (step === "complete" && importResult) {
    const committedMetricSummary = buildCommittedMetricTranslationSummary({
      periodName,
      result: importResult,
    });

    const unmatchedRawNamesMap = new Map<string, { rawName: string; rows: number[] }>();
    for (const preview of previews) {
      for (const res of preview.summary.results) {
        if (res.status === "unmatched" && res.rawName) {
          const key = res.rawName.trim().toLowerCase();
          const existing = unmatchedRawNamesMap.get(key) || { rawName: res.rawName.trim(), rows: [] };
          if (!existing.rows.includes(res.sourceRow)) {
            existing.rows.push(res.sourceRow);
          }
          unmatchedRawNamesMap.set(key, existing);
        }
      }
    }
    const unmatchedMembersList = Array.from(unmatchedRawNamesMap.values());

    const committedFormulaWarnings = warningCellIssues.filter((issue) => {
      if (issue.rowIndex === undefined) return true;

      const preview = previews.find((p) => p.columnIndex === issue.columnIndex);
      if (!preview) return false;

      const selections = duplicateSelections[preview.columnIndex];
      const selectedIndices = new Set(Object.values(selections ?? {}));

      return preview.summary.results.some(
        (r, index) =>
          selectedIndices.has(index) &&
          r.sourceRow === issue.rowIndex + 1 &&
          r.status !== "invalid_value" &&
          Boolean(r.memberId) &&
          Boolean(r.rawValue)
      );
    });

    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <SpreadsheetTranslationSummary mode="committed_metrics" summary={committedMetricSummary} />

        <div className="w-full p-6 rounded-lg bg-success/10 border border-success/30 flex flex-col gap-4">
          <div className="text-center">
            <h3 className="text-lg font-bold text-success">Evaluation Results Imported</h3>
            <p className="text-sm text-text-secondary mt-1">
              Evaluation results have been recorded into destination period &apos;{periodName}&apos;.
            </p>
          </div>

          <div className="bg-surface border border-border rounded-lg p-4">
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">Committed Values</h4>
            <ul className="divide-y divide-border text-sm">
              {importResult.perMetric.map((m) => (
                <li key={m.metricId} className="flex items-center justify-between py-2 text-text-primary">
                  <span>{m.name}</span>
                  <span className="font-mono font-semibold">{m.count} values</span>
                </li>
              ))}
              <li className="flex items-center justify-between pt-2.5 font-bold text-success border-t border-border">
                <span>Total Recorded Values</span>
                <span className="font-mono text-base">{importResult.totalCount}</span>
              </li>
            </ul>
          </div>

          {((importResult.created?.length ?? 0) > 0 ||
            (importResult.attached?.length ?? 0) > 0 ||
            (importResult.reused?.length ?? 0) > 0) && (
            <div className="bg-surface border border-border rounded-lg p-4 text-sm text-text-secondary space-y-1">
              <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">Metric Configuration</h4>
              {(importResult.created?.length ?? 0) > 0 && (
                <p>
                  <strong className="text-primary-light font-semibold">Created {importResult.created.length} new {importResult.created.length === 1 ? "metric" : "metrics"}:</strong>{" "}
                  {importResult.created.map((m) => m.name).join(", ")}
                </p>
              )}
              {(importResult.attached?.length ?? 0) > 0 && (
                <p>
                  <strong className="text-primary-light font-semibold">Added {importResult.attached.length} to period:</strong>{" "}
                  {importResult.attached.map((m) => m.name).join(", ")}
                </p>
              )}
              {(importResult.reused?.length ?? 0) > 0 && (
                <p>
                  <strong className="text-text-secondary font-semibold">Reused {importResult.reused.length} existing on period:</strong>{" "}
                  {importResult.reused.map((m) => m.name).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        {(unmatchedMembersList.length > 0 || committedFormulaWarnings.length > 0 || totalSkippedBlanks > 0) && (
          <div className="w-full p-4 bg-surface-secondary border border-border rounded-lg flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Not Imported / Excluded Input</h4>
            {unmatchedMembersList.length > 0 && (
              <p className="text-sm text-text-secondary">
                <strong>{unmatchedMembersList.length} unmatched player {unmatchedMembersList.length === 1 ? "name was" : "names were"} skipped</strong> (names not found in member list).
              </p>
            )}
            {totalSkippedBlanks > 0 && (
              <p className="text-sm text-text-secondary">
                <strong>{totalSkippedBlanks} blank metric {totalSkippedBlanks === 1 ? "cell was" : "cells were"} skipped</strong> (no entries or zeroes created).
              </p>
            )}
            {committedFormulaWarnings.length > 0 && (
              <p className="text-sm text-text-secondary">
                <strong>{committedFormulaWarnings.length} formula {committedFormulaWarnings.length === 1 ? "cell used" : "cells used"} pre-calculated cached values</strong> from spreadsheet for committed entries.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 justify-end w-full">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary cursor-pointer text-sm font-medium"
          >
            Import More Results
          </button>
          <Link
            href={`/alliances/${allianceId}/members?periodId=${periodId}`}
            className="px-4 py-2 rounded-md border border-primary/40 bg-primary/10 text-primary-light hover:bg-primary/20 text-sm font-medium inline-block text-center"
          >
            View Member Results
          </Link>
          <Link
            href={`/alliances/${allianceId}/periods/${periodId}`}
            className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover text-sm font-medium inline-block text-center"
          >
            View Evaluation Period
          </Link>
        </div>
      </div>
    );
  }

  // Select step
  if (step === "select") {
    const unconfirmedPeriodColumns = columnMappings.filter(
      (m) =>
        m.classification.reason === "matches_period_pattern" &&
        m.confirmationStatus === "unconfirmed",
    );

    const unconfirmedColumns = columnMappings.filter(
      (m) => m.confirmationStatus === "unconfirmed",
    );

    const hasUnacknowledgedMultiPeriod =
      periodProposalReview?.mode === "multi_period" && !declinedMultiPeriod;

    const showPeriodProposalReview =
      periodProposalReview &&
      !(
        periodProposalReview.mode === "multi_period" && declinedMultiPeriod
      ) &&
      !(
        periodProposalReview.mode === "single_period_suggestion" &&
        dismissedPeriodSuggestion
      ) &&
      (periodProposalReview.mode === "multi_period" ||
        periodProposalReview.mode === "single_period_suggestion" ||
        periodProposalReview.reviewableColumns.length > 0);

    const canProceed =
      Boolean(autoDetectedPlayerColumn) &&
      numericColumns.length > 0 &&
      !noSelectableMetrics &&
      mappedColumns.length > 0 &&
      !hasBlockingDiagnostics &&
      !hasValueIssuesBeforePreview &&
      (!tableBounds?.needsConfirmation || isHeaderConfirmed) &&
      unconfirmedColumns.length === 0 &&
      !hasUnacknowledgedMultiPeriod;

    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        {parsedWorkbook && (
          <WorkbookSheetSelector
            sheets={parsedWorkbook.sheets}
            selectedSheetIndex={selectedSheetIndex}
            onSelectSheet={handleSelectSheet}
            disabled={isPending}
          />
        )}

        {/* Table Region Selector */}
        {tableBounds && tableBounds.tableRegions.length > 1 && (
          <div className="p-4 bg-surface-secondary border border-border rounded-lg flex flex-col gap-2">
            <p className="font-semibold text-text-primary text-sm flex items-center justify-between">
              <span>Multiple Tables Detected on Sheet ({tableBounds.tableRegions.length})</span>
              <span className="text-xs text-primary-light font-normal">Isolates column mapping</span>
            </p>
            <p className="text-xs text-text-secondary">
              Select which table region to import from. Metric columns will strictly pair with player names in that region:
            </p>
            <div className="flex flex-col gap-1.5 mt-1">
              {tableBounds.tableRegions.map((region, idx) => (
                <label
                  key={region.id}
                  className={`flex items-center gap-2 text-sm p-2 rounded cursor-pointer border ${
                    selectedRegionIndex === idx
                      ? "border-primary bg-primary/10 text-text-primary font-medium"
                      : "border-border text-text-secondary hover:bg-surface"
                  }`}
                >
                  <input
                    type="radio"
                    name="tableRegion"
                    checked={selectedRegionIndex === idx}
                    onChange={() => handleSelectRegion(idx)}
                    className="text-primary"
                  />
                  <span>{region.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Low-confidence Header Confirmation */}
        {tableBounds && (tableBounds.needsConfirmation || tableBounds.tableRegions.length > 1) && !isHeaderConfirmed && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-3">
            <div>
              <p className="font-semibold text-amber-200 text-sm">Confirm Header Row &amp; Table Region</p>
              <p className="text-xs text-amber-300/90 mt-1">
                {tableBounds.tableRegions.length > 1
                  ? "Multiple tables were detected. Confirm your table selection and header row before mapping columns."
                  : "Header row detection confidence is low. Please confirm which row contains your column headers."}
              </p>
            </div>
            {tableBounds.candidates.length > 0 && (
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-amber-200 font-medium">Header Row:</span>
                <select
                  value={selectedHeaderRowIndex}
                  onChange={(e) => handleSelectHeaderRow(Number(e.target.value))}
                  className="p-2 rounded border border-border bg-surface text-text-primary text-xs"
                >
                  {tableBounds.candidates.map((c) => (
                    <option key={c.rowIndex} value={c.rowIndex}>
                      Row {c.rowIndex + 1}: {c.sampleHeaders.join(", ")}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsHeaderConfirmed(true)}
              className="px-3 py-1.5 rounded bg-primary text-white text-xs font-medium hover:bg-primary-hover self-start cursor-pointer"
            >
              Confirm Header &amp; Table Region
            </button>
          </div>
        )}

        {/* Inferential Period Notice Card */}
        {unconfirmedPeriodColumns.length > 0 && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-3">
            <div>
              <p className="font-semibold text-amber-200 text-sm">This file may include multiple periods</p>
              <p className="text-xs text-amber-300/90 mt-1">
                Single-period import records results into <strong>{periodName}</strong>. Some columns ({unconfirmedPeriodColumns.map((c) => `\u201c${c.columnName}\u201d`).join(", ")}) appear to name evaluation periods rather than metrics. Confirm whether to import these columns as metrics for {periodName} or skip them. To import data into a different evaluation period, open that period and import this spreadsheet.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {unconfirmedPeriodColumns.map((col) => (
                <div key={col.columnIndex} className="flex items-center justify-between bg-surface border border-border p-2.5 rounded text-xs gap-2">
                  <span className="font-medium text-text-primary">&ldquo;{col.columnName}&rdquo;</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmPeriodColumnAsMetric(col.columnIndex, col.columnName)}
                      className="px-2.5 py-1 rounded bg-surface border border-border text-text-primary hover:bg-surface-secondary cursor-pointer font-medium"
                    >
                      Keep as metric for {periodName}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmColumnAsSkip(col.columnIndex)}
                      className="px-2.5 py-1 rounded bg-surface-secondary border border-border text-text-secondary hover:text-text-primary cursor-pointer font-medium"
                    >
                      Skip this column
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Excluded Data Disclosure */}
        {tableBounds && tableBounds.hasExcludedDataBelow && (
          <div className="p-3 bg-surface-secondary border border-border rounded-lg text-xs text-text-secondary">
            <p className="font-medium text-text-primary">Table Region Bounds Disclosure:</p>
            <p className="mt-0.5">
              Detected active data rows {tableBounds.dataStartIndex + 1}–{tableBounds.dataEndIndex}.{" "}
              {tableBounds.excludedRowsCount} non-empty {tableBounds.excludedRowsCount === 1 ? "row" : "rows"} below row {tableBounds.dataEndIndex} were excluded (summary footers / trailing notes).
            </p>
          </div>
        )}

        {showPeriodProposalReview && periodProposalReview && (
            <PeriodProposalReview
              review={periodProposalReview}
              destinationPeriodName={periodName}
              onDecline={() => setDeclinedMultiPeriod(true)}
              onDismissSuggestion={() => setDismissedPeriodSuggestion(true)}
              onAcceptReview={
                periodProposalReview.mode === "multi_period" && alliancePeriods.length > 0
                  ? () => setMultiPeriodFlowActive(true)
                  : undefined
              }
            />
          )}

        {hasUnacknowledgedMultiPeriod ? (
          <div className="p-4 bg-surface-secondary/60 border border-border rounded-lg text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Fixed-period import is paused</p>
            <p className="mt-1 text-xs">
              This spreadsheet may contain multiple evaluation periods. Review the proposal above and
              explicitly choose &ldquo;Decline &amp; Use Selected Period Instead&rdquo; to continue
              importing into <strong>{periodName}</strong>.
            </p>
          </div>
        ) : (
          <>
            <div className="p-4 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary font-medium">
              Destination Period: {periodName}
            </div>
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-sm text-text-primary">
              <p className="font-medium text-text-primary">Evaluation Results Import Scope</p>
              <p className="mt-0.5 text-text-secondary">
                Importing results for destination period &apos;{periodName}&apos;. This matches existing active members in your member list; unmatched names are skipped. During mapping, authorized users may attach an existing metric or create a new one. This workflow does not create members.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-primary">Map Columns to Metrics</h3>
              <button onClick={handleBack} className="text-sm text-text-muted hover:text-text-primary cursor-pointer">
                ← Start Over
              </button>
            </div>

            <WorkbookIssueNotice
              issues={blockingCellIssues}
              tone="blocking"
              columnNameForIssue={columnNameForIssue}
            />
            <WorkbookIssueNotice
              issues={warningCellIssues}
              tone="warning"
              columnNameForIssue={columnNameForIssue}
            />
            <ValueIssueNotice issues={valueIssuesBeforePreview} phase="preview" />

            {autoDetectedPlayerColumn ? (
              <div className="p-4 rounded-md bg-success/10 border border-success/30">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-text-primary font-medium">
                    Player column found: <strong>{autoDetectedPlayerColumn.name}</strong>
                  </p>
                </div>
                <p className="text-text-secondary text-sm mt-1 ml-7">{rowCount} rows detected</p>
              </div>
            ) : (
              <div className="p-4 rounded-md bg-danger/10 border border-danger/30">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <p className="text-danger font-semibold">No player column found</p>
                </div>
                <p className="text-sm text-text-secondary mt-2 ml-7">Please rename a column in your spreadsheet to one of these:</p>
                <ul className="text-sm text-text-secondary mt-1 ml-7 list-disc list-inside">
                  <li><strong>Player</strong> or <strong>Player Name</strong></li>
                  <li><strong>Member</strong> or <strong>Member Name</strong></li>
                  <li><strong>Name</strong>, <strong>IGN</strong>, or <strong>Alliance Member</strong></li>
                </ul>
              </div>
            )}

            {numericColumns.length === 0 && (
              <div className="p-4 rounded-md bg-danger/10 border border-danger/30">
                <p className="text-danger font-semibold">No numeric columns found</p>
                <p className="text-sm text-text-secondary mt-1">Your spreadsheet needs at least one column with whole numbers.</p>
              </div>
            )}

            {noSelectableMetrics && (
              <div className="p-4 rounded-md bg-danger/10 border border-danger/30">
                <p className="text-danger font-semibold">No metrics available</p>
                <p className="text-sm text-text-secondary mt-1">Ask an alliance admin to add metrics, then import again.</p>
              </div>
            )}

            {autoDetectedPlayerColumn && numericColumns.length > 0 && !noSelectableMetrics && (
              <>
                <div className="p-4 bg-surface-secondary rounded-md border border-border">
              <p className="text-sm font-semibold text-text-primary mb-1">Choose which metric each column should import as</p>
              <p className="text-sm text-text-secondary mb-3">
                Known metric matches are mapped automatically. Columns that look like evaluation periods require confirmation. Unrecognized columns default to Do not import.
              </p>
              <div className="flex flex-col gap-3">
                {columnMappings.map((mapping) => {
                  const usedElsewhere = new Set(
                    columnMappings
                      .filter((m) => m.columnIndex !== mapping.columnIndex)
                      .map((m) => (m.target.kind === "existing" || m.target.kind === "attach") ? m.target.metricId : null)
                      .filter((id): id is string => id !== null),
                  );
                  const isPeriodLike = mapping.classification.reason === "matches_period_pattern";
                  const isAmbiguous = mapping.classification.reason === "ambiguous_name";

                  return (
                    <div key={mapping.columnIndex} className="flex flex-col gap-1.5 p-3 rounded-md bg-surface border border-border">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="truncate font-medium text-text-primary text-sm" title={mapping.columnName}>
                            {mapping.columnName}
                          </span>
                          {isPeriodLike && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Looks like a period name
                            </span>
                          )}
                          {mapping.target.kind === "create" && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-primary/20 text-primary-light border border-primary/30">
                              New metric: &ldquo;{mapping.target.name}&rdquo;
                            </span>
                          )}
                          {isAmbiguous && mapping.confirmationStatus === "unconfirmed" && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Ambiguous column — confirm choice
                            </span>
                          )}
                          {isAmbiguous && mapping.confirmationStatus !== "unconfirmed" && mapping.target.kind === "skip" && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-surface-secondary text-text-muted border border-border">
                              Confirmed Do not import
                            </span>
                          )}
                        </div>
                        {(isPeriodLike || isAmbiguous) && mapping.confirmationStatus === "unconfirmed" && (
                          <span className="text-xs text-amber-400 font-medium whitespace-nowrap">Confirmation required</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <select
                          aria-label={`Metric for ${mapping.columnName}`}
                          value={targetToToken(mapping.target)}
                          onChange={(e) => setColumnTarget(mapping.columnIndex, e.target.value, mapping.columnName)}
                          className="flex-1 rounded-md border border-border p-2 text-sm text-text-primary bg-surface focus:border-primary"
                        >
                          <option value="">Do not import</option>
                          {metrics.length > 0 && (
                            <optgroup label="On this period">
                              {metrics.map((metric) => (
                                <option key={metric.id} value={`existing:${metric.id}`} disabled={usedElsewhere.has(metric.id)}>
                                  {metric.name}{usedElsewhere.has(metric.id) ? " (already mapped)" : ""}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {canAttachMetrics && libraryMetrics.length > 0 && (
                            <optgroup label="Add to this period">
                              {libraryMetrics.map((metric) => (
                                <option key={metric.id} value={`attach:${metric.id}`} disabled={usedElsewhere.has(metric.id)}>
                                  {metric.name}{usedElsewhere.has(metric.id) ? " (already mapped)" : ""}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {canCreateMetrics && (
                            <option value="create">Create &ldquo;{mapping.columnName}&rdquo;</option>
                          )}
                        </select>

                        {mapping.confirmationStatus === "unconfirmed" && mapping.target.kind === "skip" && (
                          <button
                            type="button"
                            onClick={() => handleConfirmColumnAsSkip(mapping.columnIndex)}
                            className="px-2.5 py-1.5 rounded bg-surface border border-border text-text-primary hover:bg-surface-secondary cursor-pointer text-xs font-medium whitespace-nowrap"
                          >
                            Confirm Do not import
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {mappedColumns.length > 0 && (
              <div className="p-4 rounded-md bg-primary/10 border border-primary/30 text-text-primary">
                <p className="font-medium mb-1">
                  Ready to import {mappedColumns.length} {mappedColumns.length === 1 ? "metric" : "metrics"}:
                </p>
                <ul className="text-text-secondary text-sm list-disc list-inside">
                  <li>Player names from: <strong>{autoDetectedPlayerColumn.name}</strong></li>
                  {mappedColumns.map((m) => {
                    const disp = m.target.kind === "skip" ? "existing" : m.target.kind;
                    return (
                      <li key={m.columnIndex}>
                        <strong>{m.columnName}</strong> → <strong>{displayNameFor(m.target, m.columnName)}</strong>
                        {disp !== "existing" && (
                          <span className="ml-1 text-xs text-primary-light">({DISPOSITION_BADGE[disp].label})</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
          </>
        )}

        {error && (
          <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger">{error}</div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={handleBack} className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary cursor-pointer">
            Cancel
          </button>
          {!hasUnacknowledgedMultiPeriod && (
            <button
              onClick={handleSelectComplete}
              disabled={!canProceed}
              className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Preview Import
            </button>
          )}
        </div>
      </div>
    );
  }

  // Preview step
  if (step === "preview" && previews.length > 0) {
    const hasBlockingParseErrors = previews.some((preview) =>
      preview.summary.results.some((r) => r.status === "invalid_value" || !!r.error)
    );
    const hasBlockingDiagnostics = blockingCellIssues.length > 0;

    const distinctMatchedMemberIds = new Set<string>();
    previews.forEach((p) => {
      const selections = duplicateSelections[p.columnIndex];
      const selectedIndices = selections ? new Set(Object.values(selections)) : null;
      p.summary.results.forEach((r, idx) => {
        const isSelected = selectedIndices ? selectedIndices.has(idx) : true;
        if (r.status !== "unmatched" && r.memberId && isSelected) {
          distinctMatchedMemberIds.add(r.memberId);
        }
      });
    });

    const plannedSummary = buildPlannedMetricTranslationSummary({
      periodName,
      translations: columnTranslations,
      matchedMembersCount: distinctMatchedMemberIds.size,
      totalEntriesCount: totalToImport,
    });

    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        {parsedWorkbook && (
          <WorkbookSheetSelector
            sheets={parsedWorkbook.sheets}
            selectedSheetIndex={selectedSheetIndex}
            onSelectSheet={handleSelectSheet}
            disabled={isPending}
          />
        )}

        <SpreadsheetTranslationSummary mode="planned_metrics" summary={plannedSummary} />

        {columnTranslations.length > 0 && (
          <SourceColumnTranslationsSection translations={columnTranslations}>
            {columnTranslations.map((t) => (
              <ColumnTranslationCard
                key={t.columnIndex}
                translation={t}
                metricOptions={metrics}
                libraryMetricOptions={libraryMetrics}
                canCreateMetrics={canCreateMetrics}
                canAttachMetrics={canAttachMetrics}
                onTargetChange={(columnIndex, target) => {
                  if (target.kind === "skip") {
                    setColumnTarget(columnIndex, "skip", "");
                  } else if (target.kind === "create") {
                    setColumnTarget(columnIndex, "create", target.name);
                  } else if (target.kind === "existing") {
                    setColumnTarget(columnIndex, `existing:${target.metricId}`, "");
                  } else if (target.kind === "attach") {
                    setColumnTarget(columnIndex, `attach:${target.metricId}`, "");
                  }
                }}
                onConfirmMetric={(columnIndex) => {
                  const mapping = columnMappings.find((m) => m.columnIndex === columnIndex);
                  if (mapping) {
                    handleConfirmPeriodColumnAsMetric(columnIndex, mapping.columnName);
                  }
                }}
                onConfirmSkip={handleConfirmColumnAsSkip}
              />
            ))}
          </SourceColumnTranslationsSection>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">Review &amp; Confirm Import</h3>
          <button onClick={handleBack} className="text-sm text-text-muted hover:text-text-primary cursor-pointer">
            ← Back
          </button>
        </div>

        <WorkbookIssueNotice
          issues={blockingCellIssues}
          tone="blocking"
          columnNameForIssue={columnNameForIssue}
        />
        <WorkbookIssueNotice
          issues={warningCellIssues}
          tone="warning"
          columnNameForIssue={columnNameForIssue}
        />
        <ValueIssueNotice issues={valueIssuesBeforePreview} phase="preview" />

        {hasBlockingParseErrors && (
          <ValueIssueNotice
            issues={parseErrors.map((err) => {
              const separatorIndex = err.indexOf(": ");
              return separatorIndex > 0
                ? { columnName: err.slice(0, separatorIndex), error: err.slice(separatorIndex + 2) }
                : { columnName: "Spreadsheet", error: err };
            })}
            phase="import"
          />
        )}

        <MetricPreviewAccordion
          previews={previews}
          selectionsByColumn={duplicateSelections}
          onDuplicateSelection={handleDuplicateSelection}
        />

        {error && (
          <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger">{error}</div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={handleBack} className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary cursor-pointer">
            Back
          </button>
          <button
            onClick={handleImport}
            disabled={isPending || totalToImport === 0 || hasBlockingParseErrors || hasBlockingDiagnostics}
            className="px-4 py-2 rounded-md bg-success text-white hover:bg-success/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending
              ? "Importing..."
              : `Import All (${totalToImport} ${totalToImport === 1 ? "entry" : "entries"} across ${previews.length} ${previews.length === 1 ? "metric" : "metrics"})`}
          </button>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="w-full max-w-2xl flex flex-col gap-5">
      <NumbersExportGuide
        isOpen={showNumbersGuide}
        onClose={() => setShowNumbersGuide(false)}
      />
      <div className="p-4 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary font-medium flex items-center justify-between">
        <span>Destination Period: {periodName}</span>
        <TourButton tour={smartImportTour} />
      </div>

      <SpreadsheetDataShapeGuide type="metrics" periodName={periodName} />

      <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-sm text-text-primary">
        <p className="font-medium text-text-primary">Destination: {periodName}</p>
        <p className="mt-0.5 text-text-secondary">
          Importing metric results directly into active evaluation period &apos;{periodName}&apos;. Member names are matched against active alliance members. Authorized leaders can map columns to existing metrics, attach library metrics, or create new metrics.
        </p>
      </div>

      <div data-tour="metric-upload">
        <SpreadsheetUpload
          id="csv-upload"
          ariaLabel="Upload evaluation results spreadsheet (.csv, .xlsx, .xls)"
          buttonLabel="Select Evaluation Results File"
          onFileSelected={handleFileSelected}
          isLoading={isLoadingFile}
        />
      </div>

      {parseErrorCode && error && (
        <WorkbookParseError
          code={parseErrorCode}
          message={error}
          onDismiss={() => {
            setParseErrorCode(null);
            setError(null);
          }}
        />
      )}

      {!parseErrorCode && error && (
        <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger">{error}</div>
      )}

      <div data-tour="metric-requirements" className="p-4 rounded-md bg-surface-secondary border border-border">
        <p className="font-semibold text-text-primary mb-3">Requirements:</p>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-success mt-0.5">✓</span>
            <span>A column named <strong>Player</strong>, <strong>Member</strong>, <strong>Name</strong>, or <strong>IGN</strong></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-success mt-0.5">✓</span>
            <div>
              <span>One or more numeric columns - map each to a metric on the next step</span>
              <p className="text-xs text-text-muted mt-0.5">Accepted format examples: 450000000, 450.000.000, &quot;450,000,000&quot;</p>
            </div>
          </li>
        </ul>
      </div>

      <div className="p-4 rounded-md bg-surface-secondary border border-border">
        <p className="font-semibold text-text-primary mb-3">Example Spreadsheet:</p>
        <pre className="text-sm bg-surface p-3 rounded border border-border text-text-primary font-mono">
{`Member Name,Kill Points,VS Score,Donations
Dragon,1500,2300,800
Phoenix,2300,2900,600
...`}
        </pre>
        <p className="text-sm text-text-secondary mt-2">
          Bring every metric in one file - you&apos;ll map each column to a metric and import them together.
        </p>
      </div>
    </div>
  );
}
