"use client";

import React, { useState, useTransition } from "react";
import { analyzeCSV, normalizeName, parseCSVLine } from "@/app/src/lib/memberMatcher";
import type { ColumnInfo } from "@/app/src/lib/memberMatcher";
import { TourButton } from "@/app/src/components/client";
import { importMembersTour } from "@/app/src/lib/tours";
import { importMembers } from "./action";
import type { RosterEntry, ImportResult } from "./action";

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
    playerName: string;
    thp: string;
    role: string;
    isExisting: boolean;
    isArchived: boolean;
    isDuplicateInFile: boolean;
    selected: boolean;
};

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

function parseNumber(value: string): number | undefined {
    const cleaned = value.replace(/[,\s]/g, "");
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? undefined : num;
}

export function RosterImportForm({ allianceId, existingMembers }: RosterImportFormProps) {
    const [step, setStep] = useState<ImportStep>("upload");
    const [error, setError] = useState<string | null>(null);
    const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [isPending, startTransition] = useTransition();

    // Build a map of normalized existing names to their archived status
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

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);

        // File size guard (5 MB)
        if (file.size > 5 * 1024 * 1024) {
            setError("File size exceeds maximum limit of 5 MB");
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            parseRoster(content);
        };
        reader.onerror = () => {
            setError("Failed to read file");
        };
        reader.readAsText(file);
    };

    const parseRoster = (content: string) => {
        const result = analyzeCSV(content);

        if (result.error) {
            setError(result.error);
            return;
        }

        // Detect player column (required)
        const playerCol = detectColumn(result.columns, PLAYER_COLUMN_NAMES);
        if (!playerCol) {
            setError(
                "No player column found. Your CSV must have a column named: Player, Member, Name, or IGN."
            );
            return;
        }

        // Detect optional columns
        const thpCol = detectColumn(result.columns, THP_COLUMN_NAMES);
        const roleCol = detectColumn(result.columns, ROLE_COLUMN_NAMES);

        // Parse the CSV manually to extract values
        const lines = content.trim().split(/\r?\n/);
        
        // Abuse protection ceiling for row count
        if (lines.length > 2001) {
            setError("CSV file contains too many rows (maximum 2,000 data rows allowed)");
            return;
        }

        const rawMembers: ParsedMember[] = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);
            const playerName = values[playerCol.index]?.trim() || "";

            const thpRaw = thpCol ? values[thpCol.index]?.trim() || "" : "";
            const roleValue = roleCol ? values[roleCol.index]?.trim() || "" : "";

            rawMembers.push({
                id: `row-${i}`,
                playerName,
                thp: thpRaw,
                role: roleValue,
                isExisting: false,
                isArchived: false,
                isDuplicateInFile: false,
                selected: true,
            });
        }

        if (rawMembers.length === 0) {
            setError("No valid members found in the CSV");
            return;
        }

        const reconciledMembers = reclassifyMembers(rawMembers);
        setParsedMembers(reconciledMembers);
        setStep("preview");
    };

    const updateMember = (id: string, field: keyof ParsedMember, value: string | boolean) => {
        setParsedMembers((prev) => {
            const updated = prev.map((m) => {
                if (m.id === id) {
                    if (field === "selected" && value === true && !m.playerName.trim()) {
                        return { ...m, selected: false };
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

    const isOverCapacity = (activeRosterCount + uniqueSelectedCount) > 100;
    const overflowCount = (activeRosterCount + uniqueSelectedCount) - 100;

    const handleImport = () => {
        if (parsedMembers.length === 0) {
            setImportResult({ 
                created: 0, 
                restored: 0,
                skippedExisting: 0, 
                skippedDuplicates: 0, 
                skippedEmptyNames: 0,
                skippedUnselected: 0,
                errors: [] 
            });
            setStep("complete");
            return;
        }

        const entries: RosterEntry[] = parsedMembers.map((m) => ({
            playerName: m.playerName.trim(),
            thp: parseNumber(m.thp),
            role: m.role.trim() || undefined,
            restore: m.isArchived,
            selected: m.selected,
        }));

        startTransition(async () => {
            const result = await importMembers(allianceId, entries);
            setImportResult(result);
            if (result.errors.length > 0 && result.created === 0 && result.restored === 0) {
                setError(result.errors.join("; "));
            } else {
                setError(null);
                setStep("complete");
            }
        });
    };

    const handleReset = () => {
        setStep("upload");
        setError(null);
        setParsedMembers([]);
        setImportResult(null);
    };

    // Upload step
    if (step === "upload") {
        return (
            <div className="flex flex-col gap-6">
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Upload Your Roster
                        </h2>
                        <TourButton tour={importMembersTour} />
                    </div>

                    <div
                        data-tour="roster-upload"
                        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
                    >
                        <input
                            type="file"
                            accept=".csv"
                            onChange={handleFileUpload}
                            className="hidden"
                            id="roster-file"
                        />
                        <label
                            htmlFor="roster-file"
                            className="cursor-pointer flex flex-col items-center gap-3"
                        >
                            <svg
                                className="w-12 h-12 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                />
                            </svg>
                            <span className="text-gray-700 font-medium">
                                Click to upload CSV
                            </span>
                        </label>
                    </div>

                    {error && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-red-800 font-medium">{error}</p>
                        </div>
                    )}
                </div>

                <div
                    data-tour="roster-columns"
                    className="bg-gray-50 border border-gray-200 rounded-lg p-6"
                >
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                        Supported Columns
                    </h3>
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
        const selectableMembers = parsedMembers.filter(
            (m) => !m.isExisting && !m.isDuplicateInFile && m.playerName.trim() !== ""
        );
        const allSelectableSelected = selectableMembers.length > 0 && selectableMembers.every((m) => m.selected);
        const someSelectableSelected = selectableMembers.some((m) => m.selected);
        const allExistingActive = selectableMembers.length === 0;

        return (
            <div className="flex flex-col gap-6">
                {/* Capacity warning banner */}
                {isOverCapacity && (
                    <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 flex flex-col gap-1">
                        <p className="font-semibold text-amber-900">Roster Capacity Exceeded</p>
                        <p className="text-sm text-amber-800">
                            Your alliance has {activeRosterCount} active member{activeRosterCount === 1 ? "" : "s"}, so you can add {capacityRemaining} more unique member{capacityRemaining === 1 ? "" : "s"}. You currently have {uniqueSelectedCount} unique member{uniqueSelectedCount === 1 ? "" : "s"} selected ({selectedNewMembers.length} new, {selectedRestoreMembers.length} restored). Deselect {overflowCount} member{overflowCount === 1 ? "" : "s"} to continue.
                        </p>
                    </div>
                )}

                {/* Duplicates in CSV banner */}
                {duplicateInFileRows.length > 0 && (
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg text-purple-900 flex flex-col gap-1">
                        <p className="font-semibold text-purple-900">
                            {duplicateInFileRows.length} Duplicate Row{duplicateInFileRows.length === 1 ? "" : "s"} Highlighted in CSV
                        </p>
                        <p className="text-sm text-purple-800">
                            {duplicateInFileRows.length} row{duplicateInFileRows.length === 1 ? "" : "s"} repeat a player name that appeared earlier in your file. These duplicate rows are unselected by default to prevent adding duplicates.
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
                        <p className="text-sm text-blue-700">Available roster capacity ({activeRosterCount}/100 active)</p>
                    </div>
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="text-2xl font-bold text-gray-700">
                            {parsedMembers.filter((m) => m.isExisting).length + duplicateInFileRows.length}
                        </p>
                        <p className="text-sm text-gray-500">Already active or duplicate CSV rows (skipped)</p>
                    </div>
                </div>

                {allExistingActive ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
                        <p className="text-blue-900 font-medium">Your roster is already up to date.</p>
                        <p className="text-sm text-blue-700 mt-1">All members in this file already exist as active members in your alliance.</p>
                    </div>
                ) : (
                    <>
                        {/* Editable Selectable Members Table */}
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
                                <h3 className="font-semibold text-green-900">Review & Select Members</h3>
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
                                                    <input
                                                        type="text"
                                                        value={member.thp}
                                                        onChange={(e) =>
                                                            updateMember(member.id, "thp", e.target.value)
                                                        }
                                                        disabled={!member.selected}
                                                        placeholder="e.g. 52000000"
                                                        className={`w-full px-2 py-1 border rounded text-sm ${
                                                            member.selected
                                                                ? "border-gray-300 bg-white text-gray-900"
                                                                : "border-gray-200 bg-gray-100 text-gray-500"
                                                        }`}
                                                    />
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

                        {/* Duplicate Rows in CSV (collapsed) */}
                        {duplicateInFileRows.length > 0 && (
                            <details className="bg-white border border-purple-200 rounded-lg overflow-hidden">
                                <summary className="px-4 py-3 bg-purple-50 cursor-pointer text-purple-900 font-medium">
                                    {duplicateInFileRows.length} duplicate CSV row{duplicateInFileRows.length === 1 ? "" : "s"} (will skip)
                                </summary>
                                <div className="max-h-48 overflow-y-auto">
                                    <ul className="divide-y divide-gray-100">
                                        {duplicateInFileRows.map((member) => (
                                            <li key={member.id} className="px-4 py-2 text-sm text-gray-500 flex items-center gap-2">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                                    Duplicate in CSV
                                                </span>
                                                {member.playerName}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </details>
                        )}

                        {/* Existing Active Members (collapsed) */}
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
                            disabled={isPending || uniqueSelectedCount === 0 || isOverCapacity}
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
                    <h2 className="text-xl font-bold text-green-900">Import Complete</h2>
                </div>

                <div className="flex gap-4">
                    <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                        <p className="text-3xl font-bold text-green-600">{importResult.created}</p>
                        <p className="text-sm text-gray-600">Members created</p>
                    </div>
                    {importResult.restored > 0 && (
                        <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                            <p className="text-3xl font-bold text-amber-600">{importResult.restored}</p>
                            <p className="text-sm text-gray-600">Members restored</p>
                        </div>
                    )}
                    {importResult.skippedExisting > 0 && (
                        <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                            <p className="text-3xl font-bold text-gray-500">{importResult.skippedExisting}</p>
                            <p className="text-sm text-gray-600">Already active</p>
                        </div>
                    )}
                    {importResult.skippedDuplicates > 0 && (
                        <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                            <p className="text-3xl font-bold text-gray-500">{importResult.skippedDuplicates}</p>
                            <p className="text-sm text-gray-600">Duplicates in file</p>
                        </div>
                    )}
                    {importResult.skippedEmptyNames > 0 && (
                        <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                            <p className="text-3xl font-bold text-yellow-600">{importResult.skippedEmptyNames}</p>
                            <p className="text-sm text-gray-600">Empty names skipped</p>
                        </div>
                    )}
                    {importResult.skippedUnselected > 0 && (
                        <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                            <p className="text-3xl font-bold text-slate-500">{importResult.skippedUnselected}</p>
                            <p className="text-sm text-gray-600">Unselected</p>
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
                        Import Another File
                    </button>
                    <a
                        href={`/alliances/${allianceId}/members`}
                        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    >
                        View Members
                    </a>
                </div>
            </div>
        );
    }

    return null;
}
