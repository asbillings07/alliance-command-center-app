"use client";

import { useState, useTransition } from "react";
import { parseWorkbookFile, type ParsedWorkbook, type SpreadsheetParseErrorCode } from "@/app/src/lib/workbookParser";
import { SpreadsheetUpload } from "@/app/src/components/spreadsheet/SpreadsheetUpload";
import { WorkbookSheetSelector } from "@/app/src/components/spreadsheet/WorkbookSheetSelector";
import { NumbersExportGuide } from "@/app/src/components/spreadsheet/NumbersExportGuide";
import { WorkbookParseError } from "@/app/src/components/spreadsheet/WorkbookParseError";
import { SpreadsheetDataShapeGuide } from "@/app/src/components/spreadsheet/SpreadsheetDataShapeGuide";
import { MultiPeriodImportFlow } from "@/app/src/components/spreadsheet/MultiPeriodImportFlow";
import { analyzeImportWorkbookSheet } from "@/app/src/lib/import/analyzeImportWorkbook";
import { resolveImportProposals } from "@/app/src/lib/import/periodProposal";
import type { AlliancePeriodOption } from "@/app/src/lib/import/multiPeriodImportUi";
import type { PeriodMappingReview } from "@/app/src/lib/import/periodProposal";
import type { TableBoundsResult } from "@/app/src/lib/memberMatcher";

type MemberOption = { id: string; playerName: string };
type MetricOption = { id: string; name: string };

type SetupImportFormProps = {
  allianceId: string;
  alliancePeriods: AlliancePeriodOption[];
  allianceLibraryMetrics: MetricOption[];
  members: MemberOption[];
  canCreateMetrics: boolean;
  canAttachMetrics: boolean;
  canConfigurePeriods: boolean;
  hasArchivedPeriodsOnly: boolean;
};

type FlowStep = "upload" | "analyze" | "import";

export function SetupImportForm({
  allianceId,
  alliancePeriods,
  allianceLibraryMetrics,
  members,
  canCreateMetrics,
  canAttachMetrics,
  canConfigurePeriods,
  hasArchivedPeriodsOnly,
}: SetupImportFormProps) {
  const [step, setStep] = useState<FlowStep>("upload");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showNumbersGuide, setShowNumbersGuide] = useState(false);
  const [parseErrorCode, setParseErrorCode] = useState<SpreadsheetParseErrorCode | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);
  const [selectedHeaderRowIndex, setSelectedHeaderRowIndex] = useState(0);
  const [isHeaderConfirmed, setIsHeaderConfirmed] = useState(false);
  const [tableBounds, setTableBounds] = useState<TableBoundsResult | null>(null);
  const [playerColumnIndex, setPlayerColumnIndex] = useState<number | null>(null);
  const [periodProposalReview, setPeriodProposalReview] = useState<PeriodMappingReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const analyzeSheet = (
    workbook: ParsedWorkbook,
    sheetIndex: number,
    regionIndex: number = 0,
    overrideHeaderRowIndex?: number,
  ) => {
    const result = analyzeImportWorkbookSheet(
      workbook,
      sheetIndex,
      regionIndex,
      overrideHeaderRowIndex,
    );
    if (!result.ok) {
      setError(result.error);
      setTableBounds(null);
      setPlayerColumnIndex(null);
      setPeriodProposalReview(null);
      setStep("analyze");
      return;
    }

    setTableBounds(result.analysis.tableBounds);
    setSelectedHeaderRowIndex(result.analysis.headerRowIndex);
    setSelectedRegionIndex(result.analysis.selectedRegionIndex);
    setPlayerColumnIndex(result.analysis.playerColumn.index);
    setPeriodProposalReview(result.analysis.periodProposalReview);
    setError(null);
    setStep("analyze");
  };

  const handleFileSelected = async (file: File) => {
    setError(null);
    setParseErrorCode(null);
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
      startTransition(() => {
        analyzeSheet(parseResult.workbook, parseResult.workbook.defaultSheetIndex, 0);
      });
    } catch {
      setIsLoadingFile(false);
      setError("An unexpected error occurred while reading the file.");
    }
  };

  const handleSelectSheet = (sheetIndex: number) => {
    if (!parsedWorkbook) return;
    setSelectedSheetIndex(sheetIndex);
    setError(null);
    setIsHeaderConfirmed(false);
    analyzeSheet(parsedWorkbook, sheetIndex);
  };

  const handleSelectRegion = (regionIdx: number) => {
    if (!parsedWorkbook) return;
    setSelectedRegionIndex(regionIdx);
    setIsHeaderConfirmed(false);
    analyzeSheet(parsedWorkbook, selectedSheetIndex, regionIdx);
  };

  const handleSelectHeaderRow = (headerRowIdx: number) => {
    if (!parsedWorkbook) return;
    setSelectedHeaderRowIndex(headerRowIdx);
    setIsHeaderConfirmed(false);
    analyzeSheet(parsedWorkbook, selectedSheetIndex, selectedRegionIndex, headerRowIdx);
  };

  const handleReset = () => {
    setStep("upload");
    setParseErrorCode(null);
    setParsedWorkbook(null);
    setTableBounds(null);
    setPlayerColumnIndex(null);
    setPeriodProposalReview(null);
    setError(null);
    setIsHeaderConfirmed(false);
  };

  const canProceedToImport =
    Boolean(periodProposalReview) &&
    playerColumnIndex !== null &&
    Boolean(tableBounds) &&
    (!tableBounds?.needsConfirmation || isHeaderConfirmed);

  if (
    step === "import" &&
    parsedWorkbook &&
    periodProposalReview &&
    playerColumnIndex !== null &&
    tableBounds
  ) {
    const resolvedProposals = resolveImportProposals(periodProposalReview);

    return (
      <MultiPeriodImportFlow
        allianceId={allianceId}
        routePeriodId={null}
        alliancePeriods={alliancePeriods}
        allianceLibraryMetrics={allianceLibraryMetrics}
        canCreateMetrics={canCreateMetrics}
        canAttachMetrics={canAttachMetrics}
        canConfigurePeriods={canConfigurePeriods}
        members={members}
        review={periodProposalReview}
        resolvedProposals={resolvedProposals}
        parsedWorkbook={parsedWorkbook}
        selectedSheetIndex={selectedSheetIndex}
        tableBounds={tableBounds}
        playerColumnIndex={playerColumnIndex}
        onCancel={() => setStep("analyze")}
      />
    );
  }

  if (step === "analyze" && parsedWorkbook) {
    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <WorkbookSheetSelector
          sheets={parsedWorkbook.sheets}
          selectedSheetIndex={selectedSheetIndex}
          onSelectSheet={handleSelectSheet}
        />

        {tableBounds && tableBounds.tableRegions.length > 1 && (
          <div className="p-4 bg-surface-secondary border border-border rounded-lg flex flex-col gap-2">
            <p className="font-semibold text-text-primary text-sm">
              Multiple Tables Detected on Sheet ({tableBounds.tableRegions.length})
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

        {tableBounds && (tableBounds.needsConfirmation || tableBounds.tableRegions.length > 1) && !isHeaderConfirmed && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-3">
            <div>
              <p className="font-semibold text-amber-200 text-sm">Confirm Header Row &amp; Table Region</p>
              <p className="text-xs text-amber-300/90 mt-1">
                Confirm which row contains your column headers before mapping evaluation results.
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

        {hasArchivedPeriodsOnly && (
          <div className="p-4 bg-surface-secondary border border-border rounded-lg text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Only archived evaluation periods exist</p>
            <p className="mt-1">
              You can restore an archived period, import into an active period if one becomes
              available, or create a new evaluation period during import confirmation.
            </p>
          </div>
        )}

        {periodProposalReview && (
          <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-sm">
            <p className="font-medium text-text-primary">Workbook analysis</p>
            <p className="text-text-secondary text-xs mt-1">{periodProposalReview.evidenceSummary}</p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger">{error}</div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-md border border-border cursor-pointer"
          >
            Start Over
          </button>
          <button
            type="button"
            onClick={() => setStep("import")}
            disabled={!canProceedToImport || Boolean(error)}
            className="px-4 py-2 rounded-md bg-primary text-white cursor-pointer disabled:opacity-50"
          >
            Continue to Column Mapping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl flex flex-col gap-5">
      <NumbersExportGuide isOpen={showNumbersGuide} onClose={() => setShowNumbersGuide(false)} />

      <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-sm text-text-primary">
        <p className="font-medium">Import evaluation results from your spreadsheet</p>
        <p className="mt-1 text-text-secondary">
          ACC analyzes your workbook to detect evaluation periods and metric columns. No data is
          written until you confirm the import.
        </p>
      </div>

      <SpreadsheetDataShapeGuide type="metrics" />

      <SpreadsheetUpload
        id="setup-import-upload"
        ariaLabel="Upload evaluation results spreadsheet (.csv, .xlsx, .xls)"
        buttonLabel="Select Evaluation Results File"
        onFileSelected={handleFileSelected}
        isLoading={isLoadingFile}
      />

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
    </div>
  );
}
