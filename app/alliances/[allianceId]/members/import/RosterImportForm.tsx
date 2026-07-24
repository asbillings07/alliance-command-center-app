"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { analyzeRows, normalizeName } from "@/app/src/lib/memberMatcher";
import type { ColumnInfo } from "@/app/src/lib/memberMatcher";
import { parseStrictInteger } from "@/app/src/lib/numberParser";
import { TourButton } from "@/app/src/components/client";
import { importMembersTour } from "@/app/src/lib/tours";
import { importMembers } from "./action";
import type { RosterEntry, ImportResult } from "./action";
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

type ExistingMember = {
  id: string;
  playerName: string;
  archivedAt: string | null;
};

type RosterImportFormProps = {
  allianceId: string;
  existingMembers: ExistingMember[];
};

type ImportStep = "upload" | "preview" | "complete";

type ParsedMember = {
  id: string;
  sourceRow: number;
  playerName: string;
  thp: string;
  parsedThp?: number;
  thpError?: string;
  role: string;
  isExisting: boolean;
  isArchived: boolean;
  isDuplicateInFile: boolean;
  selected: boolean;
};

function validateMemberThp(rawThp: string): { parsedThp?: number; thpError?: string } {
  const trimmed = rawThp.trim();
  if (!trimmed) {
    return { parsedThp: undefined, thpError: undefined };
  }
  const parsed = parseStrictInteger(trimmed);
  if (!parsed.success) {
    return { parsedThp: undefined, thpError: parsed.error };
  }
  if (parsed.value < 0) {
    return { parsedThp: undefined, thpError: "Total Hero Power cannot be negative" };
  }
  return { parsedThp: parsed.value, thpError: undefined };
}

const PLAYER_COLUMN_NAMES = new Set([
  "player",
  "playername",
  "player name",
  "member",
  "membername",
  "member name",
  "name",
  "ign",
  "alliance member",
  "alliancemember",
]);

const THP_COLUMN_NAMES = new Set([
  "thp",
  "total hero power",
  "totalheropower",
  "hero power",
  "heropower",
  "power",
]);

const ROLE_COLUMN_NAMES = new Set([
  "role",
  "rank",
  "position",
  "title",
  "r1",
  "r2",
  "r3",
  "r4",
  "r5",
]);

function normalizeColumnName(name: string): string {
  return name.toLowerCase().trim().replace(/[-_]/g, " ").replace(/\s+/g, " ");
}

function detectColumn(columns: ColumnInfo[], knownNames: Set<string>): ColumnInfo | null {
  for (const col of columns) {
    const normalized = normalizeColumnName(col.name);
    if (knownNames.has(normalized)) {
      return col;
    }
  }
  return null;
}

export function RosterImportForm({ allianceId, existingMembers }: RosterImportFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<ImportStep>("upload");
  const [error, setError] = useState<string | null>(null);
  const [parseErrorCode, setParseErrorCode] = useState<SpreadsheetParseErrorCode | null>(null);
  const [showNumbersGuide, setShowNumbersGuide] = useState(false);
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [mappedColumnIndices, setMappedColumnIndices] = useState<{
    playerColIndex: number | null;
    thpColIndex: number | null;
    roleColIndex: number | null;
  }>({ playerColIndex: null, thpColIndex: null, roleColIndex: null });

  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const existingMembersMap = new Map(
    existingMembers.map((m) => [
      normalizeName(m.playerName),
      { isArchived: !!m.archivedAt },
    ])
  );

  const reclassifyMembers = (members: ParsedMember[], editedId?: string): ParsedMember[] => {
    const seenNamesInFile = new Set<string>();
    return members.map((m) => {
      const playerName = m.playerName.trim();
      if (!playerName) {
        return {
          ...m,
          isExisting: false,
          isArchived: false,
          isDuplicateInFile: false,
          selected: false,
        };
      }

      const normalized = normalizeName(playerName);
      let isDuplicateInFile = false;
      let isExisting = false;
      let isArchived = false;

      if (seenNamesInFile.has(normalized)) {
        isDuplicateInFile = true;
      } else {
        seenNamesInFile.add(normalized);
        const existingInfo = existingMembersMap.get(normalized);
        if (existingInfo) {
          if (existingInfo.isArchived) {
            isArchived = true;
          } else {
            isExisting = true;
          }
        }
      }

      const isIneligible = isExisting || isDuplicateInFile;
      const wasIneligible = m.isExisting || m.isDuplicateInFile;

      let newSelected = m.selected;
      if (isIneligible) {
        newSelected = false;
      } else if (wasIneligible || m.id === editedId) {
        newSelected = true;
      } else {
        newSelected = m.selected;
      }

      return {
        ...m,
        isExisting,
        isArchived,
        isDuplicateInFile,
        selected: newSelected,
      };
    });
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
      processSheetRows(parseResult.workbook, parseResult.workbook.defaultSheetIndex);
    } catch {
      setIsLoadingFile(false);
      setError("An unexpected error occurred while reading the file.");
    }
  };

  const processSheetRows = (workbook: ParsedWorkbook, sheetIndex: number) => {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet || sheet.rows.length === 0) {
      setParsedMembers([]);
      setMappedColumnIndices({ playerColIndex: null, thpColIndex: null, roleColIndex: null });
      setError("The selected worksheet is empty.");
      return;
    }

    const analysis = analyzeRows(sheet.rows);
    if (analysis.error) {
      setParsedMembers([]);
      setMappedColumnIndices({ playerColIndex: null, thpColIndex: null, roleColIndex: null });
      setError(analysis.error);
      return;
    }

    const playerCol = detectColumn(analysis.columns, PLAYER_COLUMN_NAMES);
    if (!playerCol) {
      setParsedMembers([]);
      setMappedColumnIndices({ playerColIndex: null, thpColIndex: null, roleColIndex: null });
      setError("No player column found. Your spreadsheet must have a column named: Player, Member, Name, or IGN.");
      return;
    }

    const thpCol = detectColumn(analysis.columns, THP_COLUMN_NAMES);
    const roleCol = detectColumn(analysis.columns, ROLE_COLUMN_NAMES);

    setMappedColumnIndices({
      playerColIndex: playerCol.index,
      thpColIndex: thpCol ? thpCol.index : null,
      roleColIndex: roleCol ? roleCol.index : null,
    });

    const rawMembers: ParsedMember[] = [];
    for (let i = 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      if (!row || row.every((c) => !c.trim())) continue;

      const playerName = row[playerCol.index]?.trim() || "";
      const thpRaw = thpCol ? row[thpCol.index]?.trim() || "" : "";
      const roleValue = roleCol ? row[roleCol.index]?.trim() || "" : "";

      const thpValidation = validateMemberThp(thpRaw);
      rawMembers.push({
        id: `row-${i}`,
        sourceRow: i + 1,
        playerName,
        thp: thpRaw,
        parsedThp: thpValidation.parsedThp,
        thpError: thpValidation.thpError,
        role: roleValue,
        isExisting: false,
        isArchived: false,
        isDuplicateInFile: false,
        selected: true,
      });
    }

    if (rawMembers.length === 0) {
      setParsedMembers([]);
      setError("No valid members found in the worksheet.");
      return;
    }

    const reconciledMembers = reclassifyMembers(rawMembers);
    setParsedMembers(reconciledMembers);
    setError(null);
    setStep("preview");
  };

  const handleSelectSheet = (sheetIndex: number) => {
    if (!parsedWorkbook) return;
    setSelectedSheetIndex(sheetIndex);
    setError(null);
    processSheetRows(parsedWorkbook, sheetIndex);
  };

  const updateMember = (id: string, field: keyof ParsedMember, value: string | boolean) => {
    setParsedMembers((prev) => {
      const updated = prev.map((m) => {
        if (m.id === id) {
          if (field === "selected" && value === true && !m.playerName.trim()) {
            return { ...m, selected: false };
          }
          if (field === "thp" && typeof value === "string") {
            const { parsedThp, thpError } = validateMemberThp(value);
            return { ...m, thp: value, parsedThp, thpError };
          }
          return { ...m, [field]: value };
        }
        return m;
      });
      return field === "playerName" ? reclassifyMembers(updated, id) : updated;
    });
  };

  const toggleSelectAll = (selected: boolean) => {
    setParsedMembers((prev) =>
      prev.map((m) =>
        m.isExisting || m.isDuplicateInFile || !m.playerName.trim()
          ? { ...m, selected: false }
          : { ...m, selected }
      )
    );
  };

  const activeRosterCount = existingMembers.filter((m) => !m.archivedAt).length;
  const capacityRemaining = Math.max(0, 100 - activeRosterCount);

  const selectedCandidates = parsedMembers.filter(
    (m) => m.selected && (!m.isExisting || m.isArchived) && m.playerName.trim() !== ""
  );
  const uniqueSelectedNames = new Set(selectedCandidates.map((m) => normalizeName(m.playerName)));
  const uniqueSelectedCount = uniqueSelectedNames.size;

  const selectedNewMembers = parsedMembers.filter(
    (m) => m.selected && !m.isExisting && !m.isArchived && m.playerName.trim() !== ""
  );
  const selectedRestoreMembers = parsedMembers.filter(
    (m) => m.selected && m.isArchived && m.playerName.trim() !== ""
  );
  const duplicateInFileRows = parsedMembers.filter((m) => m.isDuplicateInFile);

  const isOverCapacity = activeRosterCount + uniqueSelectedCount > 100;
  const overflowCount = activeRosterCount + uniqueSelectedCount - 100;

  // Cell Diagnostic Blocking check for Roster
  const currentSheet = parsedWorkbook?.sheets[selectedSheetIndex];
  const mappedIndicesSet = new Set(
    [
      mappedColumnIndices.playerColIndex,
      mappedColumnIndices.thpColIndex,
      mappedColumnIndices.roleColIndex,
    ].filter((idx): idx is number => idx !== null)
  );

  const blockingCellIssues: WorkbookIssue[] = [];
  const warningCellIssues: WorkbookIssue[] = [];

  if (currentSheet && currentSheet.issues) {
    for (const issue of currentSheet.issues) {
      if (!mappedIndicesSet.has(issue.columnIndex)) continue;

      // Check if row is selected
      const memberInRow = parsedMembers.find((m) => m.sourceRow === issue.rowIndex + 1);
      if (memberInRow && memberInRow.selected) {
        if (issue.severity === "blocking" || issue.code === "formula_missing_cached_value" || issue.code === "cell_error") {
          blockingCellIssues.push(issue);
        } else if (issue.severity === "warning") {
          warningCellIssues.push(issue);
        }
      }
    }
  }

  const handleImport = () => {
    if (parsedMembers.length === 0) {
      setImportResult({
        created: 0,
        restored: 0,
        skippedExisting: 0,
        skippedDuplicates: 0,
        skippedEmptyNames: 0,
        skippedUnselected: 0,
        errors: [],
      });
      setStep("complete");
      return;
    }

    const entries: RosterEntry[] = parsedMembers.map((m) => ({
      playerName: m.playerName.trim(),
      thp: m.thp.trim() ? m.thp.trim() : undefined,
      role: m.role.trim() || undefined,
      restore: m.isArchived,
      selected: m.selected,
    }));

    startTransition(async () => {
      try {
        const result = await importMembers(allianceId, entries);
        setImportResult(result);
        if (result.errors.length > 0 && result.created === 0 && result.restored === 0) {
          setError(result.errors.join("; "));
        } else {
          setError(null);
          router.refresh();
          setStep("complete");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create members. Please try again.");
      }
    });
  };

  const handleReset = () => {
    setStep("upload");
    setError(null);
    setParseErrorCode(null);
    setParsedWorkbook(null);
    setParsedMembers([]);
    setImportResult(null);
  };

  // Upload step
  if (step === "upload") {
    return (
      <div className="flex flex-col gap-6">
        <NumbersExportGuide
          isOpen={showNumbersGuide}
          onClose={() => setShowNumbersGuide(false)}
        />
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Upload Member Spreadsheet</h2>
            <TourButton tour={importMembersTour} />
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900 mb-4">
            <p className="font-medium">Member Import Scope</p>
            <p className="mt-0.5 text-blue-800">
              This page imports member details: Name, Total Hero Power (THP), and Role. It does not import evaluation results. Existing active members are identified and skipped.
            </p>
          </div>

          <div data-tour="roster-upload">
            <SpreadsheetUpload
              id="roster-file"
              ariaLabel="Import member spreadsheet (.csv, .xlsx, .xls)"
              buttonLabel="Select Member Spreadsheet"
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
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 font-medium">{error}</p>
            </div>
          )}
        </div>

        <div
          data-tour="roster-columns"
          className="bg-gray-50 border border-gray-200 rounded-lg p-6"
        >
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Supported Columns</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="font-medium text-gray-700">Player (required)</p>
              <p className="text-gray-500">Player, Member, Name, IGN</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">THP (optional)</p>
              <p className="text-gray-500">THP, Total Hero Power, Power</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Role (optional)</p>
              <p className="text-gray-500">Role, Rank, Position</p>
            </div>
          </div>
        </div>

        {existingMembers.length > 0 && (
          <p className="text-sm text-gray-500">
            You currently have {activeRosterCount} active members and {existingMembers.length - activeRosterCount} archived members.
          </p>
        )}
      </div>
    );
  }

  // Preview step
  if (step === "preview") {
    const hasBlockingThpError = parsedMembers.some((m) => m.selected && !!m.thpError);
    const hasBlockingDiagnostics = blockingCellIssues.length > 0;
    const selectableMembers = parsedMembers.filter(
      (m) => !m.isExisting && !m.isDuplicateInFile && m.playerName.trim() !== ""
    );
    const allSelectableSelected = selectableMembers.length > 0 && selectableMembers.every((m) => m.selected);
    const someSelectableSelected = selectableMembers.some((m) => m.selected);
    const allExistingActive = selectableMembers.length === 0;

    return (
      <div className="flex flex-col gap-6">
        {parsedWorkbook && (
          <WorkbookSheetSelector
            sheets={parsedWorkbook.sheets}
            selectedSheetIndex={selectedSheetIndex}
            onSelectSheet={handleSelectSheet}
            disabled={isPending}
          />
        )}

        {/* Blocking Workbook Cell Diagnostic Banner */}
        {hasBlockingDiagnostics && (
          <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-red-900 flex flex-col gap-1">
            <p className="font-semibold text-red-900">
              Workbook Cell Issues Detected in Mapped Columns ({blockingCellIssues.length})
            </p>
            <p className="text-sm text-red-800">
              Selected rows in mapped columns contain uncalculated formulas or error cells. Please re-save your file or adjust row selection before importing:
            </p>
            <ul className="list-disc list-inside text-xs text-red-800 mt-1 max-h-32 overflow-y-auto space-y-0.5">
              {blockingCellIssues.map((issue, idx) => (
                <li key={idx}>
                  Cell <strong>{issue.address}</strong>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warning Workbook Cell Diagnostic Banner */}
        {warningCellIssues.length > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 flex flex-col gap-1">
            <p className="font-semibold text-amber-900">
              Formula Cached Values Used ({warningCellIssues.length})
            </p>
            <p className="text-sm text-amber-800">
              Formula cells with pre-calculated values will import using their cached text:
            </p>
            <ul className="list-disc list-inside text-xs text-amber-800 mt-1 max-h-24 overflow-y-auto space-y-0.5">
              {warningCellIssues.map((issue, idx) => (
                <li key={idx}>
                  Cell <strong>{issue.address}</strong>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Capacity warning banner */}
        {isOverCapacity && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 flex flex-col gap-1">
            <p className="font-semibold text-amber-900">Member Capacity Exceeded</p>
            <p className="text-sm text-amber-800">
              Your alliance has {activeRosterCount} active member{activeRosterCount === 1 ? "" : "s"}, so you can add {capacityRemaining} more unique member{capacityRemaining === 1 ? "" : "s"}. You currently have {uniqueSelectedCount} unique member{uniqueSelectedCount === 1 ? "" : "s"} selected ({selectedNewMembers.length} new, {selectedRestoreMembers.length} restored). Deselect {overflowCount} member{overflowCount === 1 ? "" : "s"} to continue.
            </p>
          </div>
        )}

        {/* Duplicates in CSV banner */}
        {duplicateInFileRows.length > 0 && (
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg text-purple-900 flex flex-col gap-1">
            <p className="font-semibold text-purple-900">
              {duplicateInFileRows.length} Duplicate Row{duplicateInFileRows.length === 1 ? "" : "s"} Highlighted in File
            </p>
            <p className="text-sm text-purple-800">
              {duplicateInFileRows.length} row{duplicateInFileRows.length === 1 ? "" : "s"} repeat a player name that appeared earlier in your file. These duplicate rows are unselected by default to prevent adding duplicates.
            </p>
          </div>
        )}

        {/* THP blocking error banner */}
        {hasBlockingThpError && (
          <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-red-900 flex flex-col gap-1">
            <p className="font-semibold text-red-900">Invalid THP Values Detected</p>
            <p className="text-sm text-red-800">
              Please fix invalid Total Hero Power (THP) values in selected rows before continuing. Accepted formats include: 450000000, 450.000.000, or &quot;450,000,000&quot;.
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-medium">{error}</p>
          </div>
        )}

        {/* Summary */}
        <div className="flex gap-4">
          <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-2xl font-bold text-green-900">{uniqueSelectedCount}</p>
            <p className="text-sm text-green-700">
              Selected unique members ({selectedNewMembers.length} new, {selectedRestoreMembers.length} restored)
            </p>
          </div>
          <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-2xl font-bold text-blue-900">{capacityRemaining}</p>
            <p className="text-sm text-blue-700">Available member capacity ({activeRosterCount}/100 active)</p>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-2xl font-bold text-gray-700">
              {parsedMembers.filter((m) => m.isExisting).length + duplicateInFileRows.length}
            </p>
            <p className="text-sm text-gray-500">Already active or duplicate file rows (skipped)</p>
          </div>
        </div>

        {allExistingActive ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
            <p className="text-blue-900 font-medium">Your member list is already up to date.</p>
            <p className="text-sm text-blue-700 mt-1">All members in this file already exist as active members in your alliance.</p>
          </div>
        ) : (
          <>
            {/* Editable Selectable Members Table */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
                <h3 className="font-semibold text-green-900">Review &amp; Select Members</h3>
                <p className="text-sm text-green-700">Select members to add or restore</p>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="w-12 px-4 py-2">
                        <input
                          type="checkbox"
                          checked={allSelectableSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelectableSelected && !allSelectableSelected;
                          }}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                      </th>
                      <th className="text-left px-4 py-2 font-medium text-gray-700">Player</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-700 w-36">THP</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-700 w-28">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectableMembers.map((member) => (
                      <tr
                        key={member.id}
                        className={`border-t border-gray-100 ${
                          member.selected ? "bg-white" : "bg-gray-50"
                        }`}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={member.selected}
                            onChange={(e) =>
                              updateMember(member.id, "selected", e.target.checked)
                            }
                            className="w-4 h-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {member.isArchived ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                Restore
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                New
                              </span>
                            )}
                            <input
                              type="text"
                              value={member.playerName}
                              onChange={(e) =>
                                updateMember(member.id, "playerName", e.target.value)
                              }
                              disabled={!member.selected}
                              className={`flex-1 px-2 py-1 border rounded text-sm ${
                                member.selected
                                  ? "border-gray-300 bg-white text-gray-900"
                                  : "border-gray-200 bg-gray-100 text-gray-500"
                              }`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-col">
                            <input
                              type="text"
                              value={member.thp}
                              onChange={(e) =>
                                updateMember(member.id, "thp", e.target.value)
                              }
                              disabled={!member.selected}
                              placeholder="e.g. 450.000.000"
                              className={`w-full px-2 py-1 border rounded text-sm ${
                                member.selected && member.thpError
                                  ? "border-red-500 bg-red-50 text-red-900"
                                  : member.selected
                                  ? "border-gray-300 bg-white text-gray-900"
                                  : "border-gray-200 bg-gray-100 text-gray-500"
                              }`}
                            />
                            {member.selected && member.thpError && (
                              <span className="text-xs text-red-600 mt-0.5">{member.thpError}</span>
                            )}
                            {member.selected && !member.thpError && member.parsedThp !== undefined && (
                              <span className="text-xs text-gray-500 mt-0.5 font-mono">
                                Interpreted: {member.parsedThp.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={member.role}
                            onChange={(e) =>
                              updateMember(member.id, "role", e.target.value)
                            }
                            disabled={!member.selected}
                            placeholder="e.g. R4"
                            className={`w-full px-2 py-1 border rounded text-sm ${
                              member.selected
                                ? "border-gray-300 bg-white text-gray-900"
                                : "border-gray-200 bg-gray-100 text-gray-500"
                            }`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Duplicate Rows in File */}
            {duplicateInFileRows.length > 0 && (
              <details className="bg-white border border-purple-200 rounded-lg overflow-hidden">
                <summary className="px-4 py-3 bg-purple-50 cursor-pointer text-purple-900 font-medium">
                  {duplicateInFileRows.length} duplicate file row{duplicateInFileRows.length === 1 ? "" : "s"} (will skip)
                </summary>
                <div className="max-h-48 overflow-y-auto">
                  <ul className="divide-y divide-gray-100">
                    {duplicateInFileRows.map((member) => (
                      <li key={member.id} className="px-4 py-2 text-sm text-gray-500 flex items-center gap-2">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                          Duplicate in File
                        </span>
                        {member.playerName}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            {/* Existing Active Members */}
            {parsedMembers.filter((m) => m.isExisting).length > 0 && (
              <details className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-gray-700 font-medium">
                  {parsedMembers.filter((m) => m.isExisting).length} existing active members (will skip)
                </summary>
                <div className="max-h-48 overflow-y-auto">
                  <ul className="divide-y divide-gray-100">
                    {parsedMembers
                      .filter((m) => m.isExisting)
                      .map((member) => (
                        <li key={member.id} className="px-4 py-2 text-sm text-gray-500 flex items-center gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            Active
                          </span>
                          <input
                            type="text"
                            value={member.playerName}
                            onChange={(e) =>
                              updateMember(member.id, "playerName", e.target.value)
                            }
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-700 bg-white"
                          />
                        </li>
                      ))}
                  </ul>
                </div>
              </details>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>
          {!allExistingActive && (
            <button
              onClick={handleImport}
              disabled={
                isPending ||
                uniqueSelectedCount === 0 ||
                isOverCapacity ||
                hasBlockingThpError ||
                hasBlockingDiagnostics
              }
              className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending
                ? "Importing..."
                : `Import ${uniqueSelectedCount} Unique Member${uniqueSelectedCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Complete step
  if (step === "complete" && importResult) {
    return (
      <div className="flex flex-col gap-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <svg
            className="w-12 h-12 text-green-600 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <h2 className="text-xl font-bold text-green-900">Members Imported</h2>
        </div>

        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-green-900 uppercase tracking-wider mb-3">Committed</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-green-200 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-green-600">{importResult.created}</p>
                <p className="text-sm text-gray-700 font-medium mt-1">Members created</p>
              </div>
              {importResult.restored > 0 ? (
                <div className="bg-white border border-green-200 rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold text-amber-600">{importResult.restored}</p>
                  <p className="text-sm text-gray-700 font-medium mt-1">Members restored</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-4 text-center opacity-75">
                  <p className="text-3xl font-bold text-gray-400">0</p>
                  <p className="text-sm text-gray-500 font-medium mt-1">Members restored</p>
                </div>
              )}
            </div>
          </div>

          {(importResult.skippedExisting > 0 ||
            importResult.skippedDuplicates > 0 ||
            importResult.skippedEmptyNames > 0 ||
            importResult.skippedUnselected > 0) && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-2">
                Not Imported / Unchanged
              </h3>
              <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                {importResult.skippedExisting > 0 && (
                  <li>
                    <strong>{importResult.skippedExisting}</strong> existing active members were already active in your member list (identified as unchanged)
                  </li>
                )}
                {importResult.skippedDuplicates > 0 && (
                  <li>
                    <strong>{importResult.skippedDuplicates}</strong> duplicate rows in file ignored
                  </li>
                )}
                {importResult.skippedEmptyNames > 0 && (
                  <li>
                    <strong>{importResult.skippedEmptyNames}</strong> rows with empty player names skipped
                  </li>
                )}
                {importResult.skippedUnselected > 0 && (
                  <li>
                    <strong>{importResult.skippedUnselected}</strong> rows were unselected during review
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {importResult.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="font-medium text-red-800">Some errors occurred:</p>
            <ul className="mt-2 text-sm text-red-700 list-disc list-inside">
              {importResult.errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            Import More Members
          </button>
          <Link
            href={`/alliances/${allianceId}/members`}
            className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 inline-block text-center font-medium"
          >
            View Members
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
