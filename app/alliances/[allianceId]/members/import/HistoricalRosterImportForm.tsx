"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { analyzeRows, normalizeName, detectTableBounds, TableBoundsResult } from "@/app/src/lib/memberMatcher";
import { PLAYER_COLUMN_NAMES, THP_COLUMN_NAMES, ROLE_COLUMN_NAMES, detectColumn } from "@/app/src/lib/importConstants";
import { parseStrictInteger } from "@/app/src/lib/numberParser";
import { MAX_ACTIVE_ALLIANCE_MEMBERS, getAvailableMemberCapacity } from "@/app/src/lib/memberCapacity";
import { importHistoricalRoster } from "./historicalAction";
import type { HistoricalRosterEntry, HistoricalImportResult } from "./historicalAction";
import { classifyHistoricalRosterRow, outcomeConsumesActiveCapacity } from "./historicalClassification";
import type { HistoricalFinalStatus, HistoricalRowOutcome } from "./historicalClassification";
import { computeHistoricalImportFingerprint } from "./historicalImportFingerprint";
import type { HistoricalFingerprintRow } from "./historicalImportFingerprint";
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

type ExistingMember = {
    id: string;
    playerName: string;
    archivedAt: string | null;
};

type HistoricalRosterImportFormProps = {
    allianceId: string;
    existingMembers: ExistingMember[];
    returnTo?: string;
};

type ImportStep = "upload" | "preview" | "complete";

type HistoricalParsedMember = {
    id: string;
    sourceRow: number;
    playerName: string;
    thp: string;
    parsedThp?: number;
    thpError?: string;
    role: string;
    isDuplicateInFile: boolean;
    selected: boolean;
    matchedMemberId: string | null;
    /** Null only when matchedMemberId is null. */
    currentlyArchived: boolean | null;
    finalStatus: HistoricalFinalStatus;
};

type FilterTab = "all" | "unassigned" | "active" | "archived" | "conflicts";

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

function classificationFor(member: HistoricalParsedMember) {
    return classifyHistoricalRosterRow(
        { matched: member.matchedMemberId !== null, currentlyArchived: !!member.currentlyArchived },
        member.finalStatus
    );
}

function outcomeLabel(outcome: HistoricalRowOutcome): { label: string; className: string } {
    switch (outcome) {
        case "CREATE_ACTIVE":
            return { label: "New — Active", className: "bg-success/20 text-success" };
        case "CREATE_ARCHIVED":
            return { label: "New — Archived", className: "bg-primary/20 text-primary-light" };
        case "RESTORE":
            return { label: "Restore to Active", className: "bg-warning/20 text-warning" };
        case "ALREADY_MATCHES":
            return { label: "Preserve (unchanged)", className: "bg-surface-secondary border border-border text-text-muted" };
        case "LIFECYCLE_CONFLICT":
            return { label: "Conflict — active member", className: "bg-danger/20 text-danger" };
        case "UNASSIGNED_BLOCKED":
            return { label: "Unassigned", className: "bg-warning/20 text-warning" };
    }
}

export function HistoricalRosterImportForm({ allianceId, existingMembers, returnTo }: HistoricalRosterImportFormProps) {
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
    const [tableBounds, setTableBounds] = useState<TableBoundsResult | null>(null);
    const [parsedMembers, setParsedMembers] = useState<HistoricalParsedMember[]>([]);
    const [activeTab, setActiveTab] = useState<FilterTab>("all");
    const [importResult, setImportResult] = useState<HistoricalImportResult | null>(null);
    const [isPending, startTransition] = useTransition();

    const existingMembersMap = new Map(
        existingMembers.map((m) => [normalizeName(m.playerName), { id: m.id, isArchived: !!m.archivedAt }])
    );

    const reclassifyMembers = (members: HistoricalParsedMember[], editedId?: string): HistoricalParsedMember[] => {
        const seenNamesInFile = new Set<string>();
        return members.map((m) => {
            const playerName = m.playerName.trim();
            if (!playerName) {
                return {
                    ...m,
                    isDuplicateInFile: false,
                    matchedMemberId: null,
                    currentlyArchived: null,
                    selected: false,
                    finalStatus: "unassigned",
                };
            }

            const normalized = normalizeName(playerName);
            let isDuplicateInFile = false;
            let matchedMemberId: string | null = null;
            let currentlyArchived: boolean | null = null;

            if (seenNamesInFile.has(normalized)) {
                isDuplicateInFile = true;
            } else {
                seenNamesInFile.add(normalized);
                const info = existingMembersMap.get(normalized);
                if (info) {
                    matchedMemberId = info.id;
                    currentlyArchived = info.isArchived;
                }
            }

            const wasMatched = m.matchedMemberId !== null;
            const isMatched = matchedMemberId !== null;
            const matchStateChanged = wasMatched !== isMatched || m.currentlyArchived !== currentlyArchived;

            // Matched rows initialize to "Preserve" their current lifecycle —
            // a resolved value by construction, never a silent "leave alone"
            // masquerading as unassigned (#282's "unassigned always blocks"
            // rule). Only reset when the match itself changed (e.g. the
            // player name was edited) or this is the row that was just
            // edited — an unrelated row's edit must never clobber this row's
            // explicit choice.
            let finalStatus = m.finalStatus;
            if (matchStateChanged || m.id === editedId) {
                finalStatus = isMatched ? (currentlyArchived ? "archived" : "active") : "unassigned";
            }

            let newSelected = m.selected;
            if (isDuplicateInFile) {
                newSelected = false;
            } else if (m.isDuplicateInFile || m.id === editedId) {
                newSelected = true;
            }

            return {
                ...m,
                isDuplicateInFile,
                matchedMemberId,
                currentlyArchived,
                selected: newSelected,
                finalStatus,
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

        const bounds = detectTableBounds(sheet.rows);
        const analysis = analyzeRows(sheet.rows, bounds);
        const activeBounds = analysis.tableBounds ?? bounds;
        setTableBounds(activeBounds);
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

        const rawMembers: HistoricalParsedMember[] = [];
        for (let i = activeBounds.dataStartIndex; i < activeBounds.dataEndIndex; i++) {
            const row = sheet.rows[i];
            if (!row || row.every((c) => !c.trim())) continue;

            const playerName = row[playerCol.index]?.trim() || "";
            if (!playerName) continue;

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
                isDuplicateInFile: false,
                selected: true,
                matchedMemberId: null,
                currentlyArchived: null,
                finalStatus: "unassigned",
            });
        }

        if (rawMembers.length === 0) {
            setParsedMembers([]);
            setError("No valid members found in the worksheet.");
            return;
        }

        const reconciledMembers = reclassifyMembers(rawMembers);
        setParsedMembers(reconciledMembers);
        setActiveTab("all");
        setError(null);
        setStep("preview");
    };

    const handleSelectSheet = (sheetIndex: number) => {
        if (!parsedWorkbook) return;
        setSelectedSheetIndex(sheetIndex);
        setError(null);
        processSheetRows(parsedWorkbook, sheetIndex);
    };

    const updateMember = (id: string, field: keyof HistoricalParsedMember, value: string | boolean) => {
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

    const setFinalStatusBulk = (status: HistoricalFinalStatus) => {
        setParsedMembers((prev) =>
            prev.map((m) => (m.selected && !m.isDuplicateInFile && m.playerName.trim() ? { ...m, finalStatus: status } : m))
        );
    };

    const toggleSelectAllVisible = (selected: boolean, visible: HistoricalParsedMember[]) => {
        const visibleIds = new Set(visible.map((m) => m.id));
        setParsedMembers((prev) =>
            prev.map((m) => (visibleIds.has(m.id) && !m.isDuplicateInFile && m.playerName.trim() ? { ...m, selected } : m))
        );
    };

    const activeRosterCount = existingMembers.filter((m) => !m.archivedAt).length;
    const capacityRemaining = getAvailableMemberCapacity(activeRosterCount);

    const selectableMembers = parsedMembers.filter((m) => !m.isDuplicateInFile && m.playerName.trim() !== "");
    const duplicateInFileRows = parsedMembers.filter((m) => m.isDuplicateInFile);

    const classifiedRows = selectableMembers.map((member) => ({ member, classification: classificationFor(member) }));
    const selectedClassified = classifiedRows.filter((r) => r.member.selected);
    const selectedCount = selectedClassified.length;
    const selectedUnassignedCount = selectedClassified.filter(
        (r) => r.classification.outcome === "UNASSIGNED_BLOCKED"
    ).length;
    const activeAdditions = selectedClassified.filter((r) => outcomeConsumesActiveCapacity(r.classification.outcome)).length;
    const isOverCapacity = activeRosterCount + activeAdditions > MAX_ACTIVE_ALLIANCE_MEMBERS;
    const overflowCount = activeRosterCount + activeAdditions - MAX_ACTIVE_ALLIANCE_MEMBERS;
    const selectedCreateActive = selectedClassified.filter((r) => r.classification.outcome === "CREATE_ACTIVE").length;
    const selectedCreateArchived = selectedClassified.filter((r) => r.classification.outcome === "CREATE_ARCHIVED").length;
    const selectedRestore = selectedClassified.filter((r) => r.classification.outcome === "RESTORE").length;

    const hasBlockingThpError = classifiedRows.some(
        (r) => r.member.selected && r.classification.appliedFieldPolicy === "APPLY_FILE_FIELDS" && !!r.member.thpError
    );

    const currentSheet = parsedWorkbook?.sheets[selectedSheetIndex];
    const mappedIndicesSet = new Set(
        [mappedColumnIndices.playerColIndex, mappedColumnIndices.thpColIndex, mappedColumnIndices.roleColIndex].filter(
            (idx): idx is number => idx !== null
        )
    );

    const blockingCellIssues: WorkbookIssue[] = [];
    const warningCellIssues: WorkbookIssue[] = [];
    if (currentSheet && currentSheet.issues && tableBounds) {
        for (const issue of currentSheet.issues) {
            if (!mappedIndicesSet.has(issue.columnIndex)) continue;
            if (issue.rowIndex < tableBounds.dataStartIndex || issue.rowIndex >= tableBounds.dataEndIndex) continue;

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
    const hasBlockingDiagnostics = blockingCellIssues.length > 0;

    const tabCounts: Record<FilterTab, number> = {
        all: classifiedRows.length,
        unassigned: classifiedRows.filter((r) => r.classification.outcome === "UNASSIGNED_BLOCKED").length,
        active: classifiedRows.filter(
            (r) => r.member.finalStatus === "active" && r.classification.outcome !== "UNASSIGNED_BLOCKED"
        ).length,
        archived: classifiedRows.filter(
            (r) => r.member.finalStatus === "archived" && r.classification.outcome !== "LIFECYCLE_CONFLICT"
        ).length,
        conflicts: classifiedRows.filter((r) => r.classification.outcome === "LIFECYCLE_CONFLICT").length,
    };

    const visibleRows = classifiedRows.filter((r) => {
        switch (activeTab) {
            case "unassigned":
                return r.classification.outcome === "UNASSIGNED_BLOCKED";
            case "active":
                return r.member.finalStatus === "active" && r.classification.outcome !== "UNASSIGNED_BLOCKED";
            case "archived":
                return r.member.finalStatus === "archived" && r.classification.outcome !== "LIFECYCLE_CONFLICT";
            case "conflicts":
                return r.classification.outcome === "LIFECYCLE_CONFLICT";
            case "all":
            default:
                return true;
        }
    });

    const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => r.member.selected);
    const someVisibleSelected = visibleRows.some((r) => r.member.selected);

    const handleImport = () => {
        if (parsedMembers.length === 0) {
            setImportResult({
                createdActive: 0,
                createdArchived: 0,
                restored: 0,
                skippedExisting: 0,
                skippedDuplicates: 0,
                skippedEmptyNames: 0,
                skippedUnselected: 0,
                skippedLifecycleConflict: 0,
                errors: [],
                memberImportId: null,
            });
            setStep("complete");
            return;
        }

        if (!parsedWorkbook || !currentSheet) {
            setError("Missing source file information. Please re-upload your spreadsheet.");
            return;
        }

        const entries: HistoricalRosterEntry[] = parsedMembers.map((m) => ({
            playerName: m.playerName.trim(),
            thp: m.thp.trim() ? m.thp.trim() : undefined,
            role: m.role.trim() || undefined,
            finalStatus: m.finalStatus,
            selected: m.selected,
            sourceRow: m.sourceRow,
        }));

        // Build the fingerprint from exactly the selected, resolved rows the
        // server will independently reclassify inside the lock — see
        // historicalImportFingerprint.ts. Uses the same shared
        // classifyHistoricalRosterRow() the server uses, so this can only
        // drift from the server's answer if the underlying member data
        // itself changed since this page loaded — which is exactly the
        // condition the fingerprint check exists to catch.
        const seen = new Set<string>();
        const fingerprintRows: HistoricalFingerprintRow[] = [];
        for (const m of parsedMembers) {
            const trimmed = m.playerName.trim();
            if (!trimmed) continue;
            const normalized = normalizeName(trimmed);
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            if (!m.selected) continue;

            const classification = classificationFor(m);
            if (classification.outcome === "UNASSIGNED_BLOCKED") continue;

            fingerprintRows.push({
                sourceRow: m.sourceRow,
                normalizedName: normalized,
                matchedMemberId: m.matchedMemberId,
                currentlyArchived: m.currentlyArchived,
                requestedStatus: m.finalStatus,
                appliedFieldPolicy: classification.appliedFieldPolicy,
            });
        }
        const fingerprint = computeHistoricalImportFingerprint(fingerprintRows);

        startTransition(async () => {
            try {
                const result = await importHistoricalRoster(
                    allianceId,
                    entries,
                    { fileName: parsedWorkbook.fileName, sourceSheetName: currentSheet.name },
                    fingerprint
                );
                setImportResult(result);
                if (
                    result.errors.length > 0 &&
                    result.createdActive === 0 &&
                    result.createdArchived === 0 &&
                    result.restored === 0
                ) {
                    setError(result.errors.join("; "));
                } else {
                    setError(null);
                    router.refresh();
                    setStep("complete");
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to import historical roster. Please try again.");
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
        setActiveTab("all");
    };

    // Upload step
    if (step === "upload") {
        return (
            <div className="flex flex-col gap-6">
                <NumbersExportGuide isOpen={showNumbersGuide} onClose={() => setShowNumbersGuide(false)} />

                <SpreadsheetDataShapeGuide type="roster" />

                <div className="bg-surface border border-border rounded-lg p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                        <h2 className="text-lg font-semibold text-text-primary">Upload Historical Roster Spreadsheet</h2>
                        <Link
                            href={`/alliances/${allianceId}/members/imports`}
                            className="text-sm text-text-muted hover:text-text-secondary hover:underline"
                        >
                            Import history
                        </Link>
                    </div>

                    <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-sm text-text-primary mb-4">
                        <p className="font-medium text-text-primary">Historical roster mode</p>
                        <p className="mt-0.5 text-text-secondary">
                            Use this mode to import an old roster snapshot and explicitly mark each new member as{" "}
                            <strong>Active</strong> or <strong>Archived</strong>. Existing members are never overwritten:
                            a matched active member stays active with its current THP/role/notes untouched, and an
                            existing active member can never be silently archived by a file value.
                        </p>
                    </div>

                    <div data-tour="historical-roster-upload">
                        <SpreadsheetUpload
                            id="historical-roster-file"
                            ariaLabel="Import historical roster spreadsheet (.csv, .xlsx, .xls)"
                            buttonLabel="Select Historical Roster Spreadsheet"
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
                        <div className="mt-4 p-4 bg-danger/10 border border-danger/30 rounded-lg">
                            <p className="text-danger font-medium">{error}</p>
                        </div>
                    )}
                </div>

                {existingMembers.length > 0 && (
                    <p className="text-sm text-text-secondary">
                        You currently have {activeRosterCount} active members and{" "}
                        {existingMembers.length - activeRosterCount} archived members.
                    </p>
                )}
            </div>
        );
    }

    // Preview step
    if (step === "preview") {
        const tabs: { id: FilterTab; label: string }[] = [
            { id: "all", label: "All" },
            { id: "unassigned", label: "Unassigned" },
            { id: "active", label: "Active" },
            { id: "archived", label: "Archived" },
            { id: "conflicts", label: "Conflicts" },
        ];

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

                {hasBlockingDiagnostics && (
                    <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg text-danger flex flex-col gap-1">
                        <p className="font-semibold text-danger">
                            Workbook Cell Issues Detected in Mapped Columns ({blockingCellIssues.length})
                        </p>
                        <p className="text-sm text-text-secondary">
                            Selected rows in mapped columns contain uncalculated formulas or error cells. Please
                            re-save your file or adjust row selection before importing:
                        </p>
                        <ul className="list-disc list-inside text-xs text-danger mt-1 max-h-32 overflow-y-auto space-y-0.5">
                            {blockingCellIssues.map((issue, idx) => (
                                <li key={idx}>
                                    Cell <strong>{issue.address}</strong>: {issue.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {warningCellIssues.length > 0 && (
                    <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-warning flex flex-col gap-1">
                        <p className="font-semibold text-warning">Formula Cached Values Used ({warningCellIssues.length})</p>
                        <p className="text-sm text-text-secondary">
                            Formula cells with pre-calculated values will import using their cached text:
                        </p>
                        <ul className="list-disc list-inside text-xs text-warning mt-1 max-h-24 overflow-y-auto space-y-0.5">
                            {warningCellIssues.map((issue, idx) => (
                                <li key={idx}>
                                    Cell <strong>{issue.address}</strong>: {issue.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {isOverCapacity && (
                    <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-warning flex flex-col gap-1">
                        <p className="font-semibold text-warning">Member Capacity Exceeded</p>
                        <p className="text-sm text-text-secondary">
                            Your alliance has {activeRosterCount} active member{activeRosterCount === 1 ? "" : "s"}, so
                            you can add {capacityRemaining} more to the active roster. You currently have{" "}
                            {activeAdditions} selected row{activeAdditions === 1 ? "" : "s"} that would become active (
                            {selectedCreateActive} new, {selectedRestore} restored — archived creations don&apos;t count).
                            Deselect {overflowCount} member{overflowCount === 1 ? "" : "s"} to continue.
                        </p>
                    </div>
                )}

                {selectedUnassignedCount > 0 && (
                    <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-warning flex flex-col gap-1">
                        <p className="font-semibold text-warning">
                            {selectedUnassignedCount} Selected Row{selectedUnassignedCount === 1 ? "" : "s"} Still Unassigned
                        </p>
                        <p className="text-sm text-text-secondary">
                            Assign Active or Archived to every selected row before importing — use the Unassigned tab
                            below or a bulk action to resolve them.
                        </p>
                    </div>
                )}

                {duplicateInFileRows.length > 0 && (
                    <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-text-primary flex flex-col gap-1">
                        <p className="font-semibold text-text-primary">
                            {duplicateInFileRows.length} Duplicate Row{duplicateInFileRows.length === 1 ? "" : "s"} Highlighted in File
                        </p>
                        <p className="text-sm text-text-secondary">
                            {duplicateInFileRows.length} row{duplicateInFileRows.length === 1 ? "" : "s"} repeat a player
                            name that appeared earlier in your file. These duplicate rows are unselected by default.
                        </p>
                    </div>
                )}

                {hasBlockingThpError && (
                    <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg text-danger flex flex-col gap-1">
                        <p className="font-semibold text-danger">Invalid THP Values Detected</p>
                        <p className="text-sm text-text-secondary">
                            Please fix invalid Total Hero Power (THP) values for selected new members before continuing.
                            Accepted formats include: 450000000, 450.000.000, or &quot;450,000,000&quot;.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg text-danger">
                        <p className="font-medium">{error}</p>
                    </div>
                )}

                {/* Summary */}
                <div className="flex gap-4 flex-wrap">
                    <div className="flex-1 min-w-[160px] bg-success/10 border border-success/30 rounded-lg p-4">
                        <p className="text-2xl font-bold text-success">{selectedCount}</p>
                        <p className="text-sm text-text-secondary">
                            Selected rows ({selectedCreateActive} new active, {selectedCreateArchived} new archived,{" "}
                            {selectedRestore} restored)
                        </p>
                    </div>
                    <div className="flex-1 min-w-[160px] bg-primary/10 border border-primary/30 rounded-lg p-4">
                        <p className="text-2xl font-bold text-primary-light">{capacityRemaining}</p>
                        <p className="text-sm text-text-secondary">
                            Available active capacity ({activeRosterCount}/{MAX_ACTIVE_ALLIANCE_MEMBERS} active)
                        </p>
                    </div>
                    <div className="flex-1 min-w-[160px] bg-surface-secondary border border-border rounded-lg p-4">
                        <p className="text-2xl font-bold text-text-muted">{tabCounts.conflicts}</p>
                        <p className="text-sm text-text-muted">Lifecycle conflicts (active members requesting archive)</p>
                    </div>
                </div>

                {/* Bulk controls + filter tabs */}
                <div className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary mr-2">Bulk actions:</span>
                        <button
                            type="button"
                            onClick={() => setFinalStatusBulk("active")}
                            disabled={selectedCount === 0}
                            className="px-3 py-1.5 rounded-md border border-success text-success hover:bg-success/10 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            Mark Selected Active
                        </button>
                        <button
                            type="button"
                            onClick={() => setFinalStatusBulk("archived")}
                            disabled={selectedCount === 0}
                            className="px-3 py-1.5 rounded-md border border-primary text-primary hover:bg-primary/10 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            Mark Selected Archived
                        </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer ${
                                    activeTab === tab.id
                                        ? "bg-primary text-white"
                                        : "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/70"
                                }`}
                            >
                                {tab.label} ({tabCounts[tab.id]})
                            </button>
                        ))}
                    </div>
                </div>

                {selectableMembers.length === 0 ? (
                    <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 text-center">
                        <p className="text-text-primary font-medium">No rows to review.</p>
                        <p className="text-sm text-text-secondary mt-1">
                            Every row in this file was a duplicate or had an empty player name.
                        </p>
                    </div>
                ) : (
                    <div className="bg-surface border border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-surface-secondary border-b border-border flex items-center justify-between">
                            <h3 className="font-semibold text-text-primary">Review &amp; Assign Status</h3>
                            <p className="text-sm text-text-secondary">{visibleRows.length} row(s) in this view</p>
                        </div>
                        <div className="max-h-[32rem] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-surface-secondary sticky top-0 border-b border-border">
                                    <tr>
                                        <th className="w-12 px-4 py-2">
                                            <input
                                                type="checkbox"
                                                aria-label="Select all visible rows"
                                                checked={allVisibleSelected}
                                                ref={(el) => {
                                                    if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                                                }}
                                                onChange={(e) =>
                                                    toggleSelectAllVisible(
                                                        e.target.checked,
                                                        visibleRows.map((r) => r.member)
                                                    )
                                                }
                                                className="w-4 h-4 rounded border-border"
                                            />
                                        </th>
                                        <th className="text-left px-4 py-2 font-medium text-text-primary">Player</th>
                                        <th className="text-left px-4 py-2 font-medium text-text-primary w-40">Outcome</th>
                                        <th className="text-left px-4 py-2 font-medium text-text-primary w-36">THP</th>
                                        <th className="text-left px-4 py-2 font-medium text-text-primary w-28">Role</th>
                                        <th className="text-left px-4 py-2 font-medium text-text-primary w-48">Final Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleRows.map(({ member, classification }) => {
                                        const outcome = outcomeLabel(classification.outcome);
                                        const fieldsApplied = classification.appliedFieldPolicy === "APPLY_FILE_FIELDS";
                                        return (
                                            <tr
                                                key={member.id}
                                                className={`border-t border-border ${member.selected ? "bg-surface" : "bg-surface-secondary"}`}
                                            >
                                                <td className="px-4 py-2 align-top">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Select ${member.playerName || `row ${member.sourceRow}`}`}
                                                        checked={member.selected}
                                                        onChange={(e) => updateMember(member.id, "selected", e.target.checked)}
                                                        className="w-4 h-4 rounded border-border"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 align-top">
                                                    <input
                                                        type="text"
                                                        aria-label="Player name"
                                                        value={member.playerName}
                                                        onChange={(e) => updateMember(member.id, "playerName", e.target.value)}
                                                        disabled={!member.selected}
                                                        className={`w-full px-2 py-1 border rounded text-sm ${
                                                            member.selected
                                                                ? "border-border bg-surface text-text-primary"
                                                                : "border-border/50 bg-surface-secondary text-text-disabled"
                                                        }`}
                                                    />
                                                </td>
                                                <td className="px-4 py-2 align-top">
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${outcome.className}`}
                                                    >
                                                        {outcome.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 align-top">
                                                    {fieldsApplied ? (
                                                        <div className="flex flex-col">
                                                            <input
                                                                type="text"
                                                                aria-label="Total Hero Power"
                                                                value={member.thp}
                                                                onChange={(e) => updateMember(member.id, "thp", e.target.value)}
                                                                disabled={!member.selected}
                                                                placeholder="Not provided"
                                                                className={`w-full px-2 py-1 border rounded text-sm ${
                                                                    member.selected && member.thpError
                                                                        ? "border-danger bg-danger/10 text-danger"
                                                                        : member.selected
                                                                          ? "border-border bg-surface text-text-primary"
                                                                          : "border-border/50 bg-surface-secondary text-text-disabled"
                                                                }`}
                                                            />
                                                            {member.selected && member.thpError && (
                                                                <span className="text-xs text-danger mt-0.5">{member.thpError}</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-text-muted italic">
                                                            {member.matchedMemberId ? "Preserved from current record" : "—"}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 align-top">
                                                    {fieldsApplied ? (
                                                        <input
                                                            type="text"
                                                            aria-label="Role"
                                                            value={member.role}
                                                            onChange={(e) => updateMember(member.id, "role", e.target.value)}
                                                            disabled={!member.selected}
                                                            placeholder="Not provided"
                                                            className={`w-full px-2 py-1 border rounded text-sm ${
                                                                member.selected
                                                                    ? "border-border bg-surface text-text-primary"
                                                                    : "border-border/50 bg-surface-secondary text-text-disabled"
                                                            }`}
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-text-muted italic">
                                                            {member.matchedMemberId ? "Preserved" : "—"}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 align-top">
                                                    <div className="flex gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => updateMember(member.id, "finalStatus", "active")}
                                                            disabled={!member.selected}
                                                            className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                                                member.finalStatus === "active"
                                                                    ? "bg-success text-white border-success"
                                                                    : "border-border text-text-secondary hover:bg-success/10"
                                                            }`}
                                                        >
                                                            {member.matchedMemberId && !member.currentlyArchived
                                                                ? "Preserve Active"
                                                                : "Active"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => updateMember(member.id, "finalStatus", "archived")}
                                                            disabled={!member.selected}
                                                            className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                                                member.finalStatus === "archived"
                                                                    ? "bg-primary text-white border-primary"
                                                                    : "border-border text-text-secondary hover:bg-primary/10"
                                                            }`}
                                                        >
                                                            {member.matchedMemberId && member.currentlyArchived
                                                                ? "Preserve Archived"
                                                                : "Archived"}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {duplicateInFileRows.length > 0 && (
                    <details className="bg-surface border border-border rounded-lg overflow-hidden">
                        <summary className="px-4 py-3 bg-surface-secondary cursor-pointer text-text-primary font-medium select-none">
                            {duplicateInFileRows.length} duplicate file row{duplicateInFileRows.length === 1 ? "" : "s"} (will skip)
                        </summary>
                        <div className="max-h-48 overflow-y-auto">
                            <ul className="divide-y divide-border">
                                {duplicateInFileRows.map((member) => (
                                    <li key={member.id} className="px-4 py-2 text-sm text-text-secondary flex items-center gap-2">
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary-light">
                                            Duplicate in File
                                        </span>
                                        {member.playerName}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </details>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={
                            isPending ||
                            selectedCount === 0 ||
                            selectedUnassignedCount > 0 ||
                            isOverCapacity ||
                            hasBlockingThpError ||
                            hasBlockingDiagnostics
                        }
                        className="px-4 py-2 rounded-md bg-success text-white hover:bg-success/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? "Importing..." : `Import ${selectedCount} Row${selectedCount === 1 ? "" : "s"}`}
                    </button>
                </div>
            </div>
        );
    }

    // Complete step
    if (step === "complete" && importResult) {
        return (
            <div className="flex flex-col gap-6">
                <div className="space-y-4">
                    <div className="bg-surface border border-emerald-500/30 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-3">Committed</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-surface-secondary border border-border rounded-lg p-4 text-center">
                                <p className="text-3xl font-bold text-success">{importResult.createdActive}</p>
                                <p className="text-sm text-text-secondary font-medium mt-1">Created active</p>
                            </div>
                            <div className="bg-surface-secondary border border-border rounded-lg p-4 text-center">
                                <p className="text-3xl font-bold text-primary-light">{importResult.createdArchived}</p>
                                <p className="text-sm text-text-secondary font-medium mt-1">Created archived</p>
                            </div>
                            <div className="bg-surface-secondary border border-border rounded-lg p-4 text-center">
                                <p className="text-3xl font-bold text-warning">{importResult.restored}</p>
                                <p className="text-sm text-text-secondary font-medium mt-1">Restored to active</p>
                            </div>
                        </div>
                    </div>

                    {(importResult.skippedExisting > 0 ||
                        importResult.skippedDuplicates > 0 ||
                        importResult.skippedEmptyNames > 0 ||
                        importResult.skippedUnselected > 0 ||
                        importResult.skippedLifecycleConflict > 0) && (
                        <div className="bg-surface-secondary border border-border rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-2">
                                Not Imported / Unchanged
                            </h3>
                            <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
                                {importResult.skippedExisting > 0 && (
                                    <li>
                                        <strong>{importResult.skippedExisting}</strong> members already matched their
                                        requested status (unchanged)
                                    </li>
                                )}
                                {importResult.skippedLifecycleConflict > 0 && (
                                    <li>
                                        <strong>{importResult.skippedLifecycleConflict}</strong> existing active members
                                        requested Archived were left active — use bulk archive to archive them explicitly
                                    </li>
                                )}
                                {importResult.skippedDuplicates > 0 && (
                                    <li>
                                        <strong>{importResult.skippedDuplicates}</strong> duplicate rows in file ignored
                                    </li>
                                )}
                                {importResult.skippedEmptyNames > 0 && (
                                    <li>
                                        <strong>{importResult.skippedEmptyNames}</strong> rows with empty player names
                                        skipped
                                    </li>
                                )}
                                {importResult.skippedUnselected > 0 && (
                                    <li>
                                        <strong>{importResult.skippedUnselected}</strong> rows were unselected during
                                        review
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>

                {importResult.errors.length > 0 && (
                    <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
                        <p className="font-medium text-danger">Some errors occurred:</p>
                        <ul className="mt-2 text-sm text-danger list-disc list-inside">
                            {importResult.errors.map((err, idx) => (
                                <li key={idx}>{err}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {importResult.createdActive === 0 &&
                    importResult.createdArchived === 0 &&
                    importResult.restored === 0 &&
                    importResult.errors.length === 0 && (
                        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
                            <p className="text-text-primary font-medium">Nothing was imported.</p>
                            <p className="text-sm text-text-secondary mt-1">
                                Every row already matched its requested status, was a conflict, or was skipped.
                            </p>
                        </div>
                    )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary cursor-pointer"
                    >
                        Import More
                    </button>
                    {importResult.memberImportId && (
                        <Link
                            href={`/alliances/${allianceId}/members/imports/${importResult.memberImportId}`}
                            className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary inline-block text-center font-medium"
                        >
                            View import details
                        </Link>
                    )}
                    {returnTo && (
                        <Link
                            href={returnTo}
                            className="px-4 py-2 rounded-md border border-primary text-primary hover:bg-primary/10 inline-block text-center font-medium"
                        >
                            Continue Setup
                        </Link>
                    )}
                    <Link
                        href={`/alliances/${allianceId}/members`}
                        className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover inline-block text-center font-medium"
                    >
                        View Members
                    </Link>
                </div>
            </div>
        );
    }

    return null;
}
