"use client";

import { useState, useTransition } from "react";
import { analyzeCSV, normalizeName } from "@/app/src/lib/memberMatcher";
import type { ColumnInfo } from "@/app/src/lib/memberMatcher";
import { importMembers } from "./action";
import type { RosterEntry, ImportResult } from "./action";

type ExistingMember = {
    id: string;
    playerName: string;
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

    // Build a set of normalized existing names for fast lookup
    const existingNamesNormalized = new Set(
        existingMembers.map((m) => normalizeName(m.playerName))
    );

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);

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
        const thpCol = detectColumn(
            result.columns.filter((c) => c.isNumeric),
            THP_COLUMN_NAMES
        );
        const roleCol = detectColumn(
            result.columns.filter((c) => !c.isNumeric),
            ROLE_COLUMN_NAMES
        );

        // Parse the CSV manually to extract values
        const lines = content.trim().split(/\r?\n/);
        const members: ParsedMember[] = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);
            const playerName = values[playerCol.index]?.trim();

            if (!playerName) continue;

            const thpRaw = thpCol ? values[thpCol.index]?.trim() || "" : "";
            const roleValue = roleCol ? values[roleCol.index]?.trim() || "" : "";

            const isExisting = existingNamesNormalized.has(normalizeName(playerName));

            members.push({
                id: `row-${i}`,
                playerName,
                thp: thpRaw,
                role: roleValue,
                isExisting,
                selected: !isExisting,
            });
        }

        if (members.length === 0) {
            setError("No valid members found in the CSV");
            return;
        }

        setParsedMembers(members);
        setStep("preview");
    };

    const updateMember = (id: string, field: keyof ParsedMember, value: string | boolean) => {
        setParsedMembers((prev) =>
            prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
        );
    };

    const toggleSelectAll = (selected: boolean) => {
        setParsedMembers((prev) =>
            prev.map((m) => (m.isExisting ? m : { ...m, selected }))
        );
    };

    const handleImport = () => {
        const selectedMembers = parsedMembers.filter((m) => m.selected && !m.isExisting);

        if (selectedMembers.length === 0) {
            const skippedCount = parsedMembers.filter((m) => m.isExisting).length +
                parsedMembers.filter((m) => !m.selected && !m.isExisting).length;
            setImportResult({ created: 0, skipped: skippedCount, errors: [] });
            setStep("complete");
            return;
        }

        const entries: RosterEntry[] = selectedMembers.map((m) => ({
            playerName: m.playerName.trim(),
            thp: parseNumber(m.thp),
            role: m.role.trim() || undefined,
        }));

        startTransition(async () => {
            const result = await importMembers(allianceId, entries);
            setImportResult(result);
            setStep("complete");
        });
    };

    const handleReset = () => {
        setStep("upload");
        setError(null);
        setParsedMembers([]);
        setImportResult(null);
    };

    const newMembers = parsedMembers.filter((m) => !m.isExisting);
    const selectedCount = parsedMembers.filter((m) => m.selected && !m.isExisting).length;
    const existingMembersCount = parsedMembers.filter((m) => m.isExisting).length;

    // Upload step
    if (step === "upload") {
        return (
            <div className="flex flex-col gap-6">
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Upload Your Roster
                    </h2>

                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
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
                            <span className="text-sm text-gray-500">
                                or drag and drop
                            </span>
                        </label>
                    </div>

                    {error && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-red-800 font-medium">{error}</p>
                        </div>
                    )}
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
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
                        You currently have {existingMembers.length} members. Existing members will be skipped during import.
                    </p>
                )}
            </div>
        );
    }

    // Preview step
    if (step === "preview") {
        const allExisting = newMembers.length === 0;
        const allNewSelected = newMembers.every((m) => m.selected);
        const someNewSelected = newMembers.some((m) => m.selected);

        return (
            <div className="flex flex-col gap-6">
                {/* Summary */}
                <div className="flex gap-4">
                    <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-4">
                        <p className="text-2xl font-bold text-green-900">{selectedCount}</p>
                        <p className="text-sm text-green-700">
                            Selected to create {newMembers.length > selectedCount && (
                                <span className="text-green-600">({newMembers.length} available)</span>
                            )}
                        </p>
                    </div>
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="text-2xl font-bold text-gray-700">{existingMembersCount}</p>
                        <p className="text-sm text-gray-500">Already exist (will skip)</p>
                    </div>
                </div>

                {allExisting ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
                        <p className="text-blue-900 font-medium">Your roster is already up to date.</p>
                        <p className="text-sm text-blue-700 mt-1">All members in this file already exist in your alliance.</p>
                    </div>
                ) : (
                    <>
                        {/* Editable New Members Table */}
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
                                <h3 className="font-semibold text-green-900">Review & Edit Members</h3>
                                <p className="text-sm text-green-700">Edit any field before importing</p>
                            </div>
                            <div className="max-h-96 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="w-12 px-4 py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={allNewSelected}
                                                    ref={(el) => {
                                                        if (el) el.indeterminate = someNewSelected && !allNewSelected;
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
                                        {newMembers.map((member) => (
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
                                                    <input
                                                        type="text"
                                                        value={member.playerName}
                                                        onChange={(e) =>
                                                            updateMember(member.id, "playerName", e.target.value)
                                                        }
                                                        disabled={!member.selected}
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

                        {/* Existing Members (collapsed) */}
                        {existingMembersCount > 0 && (
                            <details className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-gray-700 font-medium">
                                    {existingMembersCount} existing members (will skip)
                                </summary>
                                <div className="max-h-48 overflow-y-auto">
                                    <ul className="divide-y divide-gray-100">
                                        {parsedMembers
                                            .filter((m) => m.isExisting)
                                            .map((member) => (
                                                <li key={member.id} className="px-4 py-2 text-sm text-gray-500">
                                                    {member.playerName}
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
                    {!allExisting && (
                        <button
                            onClick={handleImport}
                            disabled={isPending || selectedCount === 0}
                            className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? "Creating..." : `Create ${selectedCount} Members`}
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
                    <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 text-center">
                        <p className="text-3xl font-bold text-gray-500">{importResult.skipped}</p>
                        <p className="text-sm text-gray-600">Already existed</p>
                    </div>
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

function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            values.push(current);
            current = "";
        } else {
            current += char;
        }
    }

    values.push(current);
    return values;
}
