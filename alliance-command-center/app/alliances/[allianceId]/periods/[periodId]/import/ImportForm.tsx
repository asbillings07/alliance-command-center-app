'use client'
import { useState, useTransition, useMemo } from "react";
import { analyzeCSV, parseCSV, matchEntriesToMembers, type MatchResult, type MatchSummary, type ColumnInfo } from "@/app/src/lib/memberMatcher";
import { importMemberMetrics } from "./action";

type Member = {
    id: string;
    playerName: string;
};

type Metric = {
    id: string;
    name: string;
};

type ImportFormProps = {
    periodId: string;
    allianceId: string;
    members: Member[];
    metrics: Metric[];
};

type ImportStep = "upload" | "map-columns" | "select-metric" | "preview" | "complete";

type DuplicateSelections = Record<string, number>;

export function ImportForm({ periodId, allianceId, members, metrics }: ImportFormProps) {
    const [step, setStep] = useState<ImportStep>("upload");
    const [csvContent, setCsvContent] = useState<string>("");
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [rowCount, setRowCount] = useState(0);
    const [playerColumn, setPlayerColumn] = useState<number | null>(null);
    const [valueColumn, setValueColumn] = useState<number | null>(null);
    const [selectedMetricId, setSelectedMetricId] = useState(metrics[0]?.id || "");
    const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importCount, setImportCount] = useState(0);
    const [isPending, startTransition] = useTransition();
    const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelections>({});

    const selectedMetric = metrics.find((m) => m.id === selectedMetricId);

    // Exact player column names we recognize (case-insensitive, spaces normalized)
    const PLAYER_COLUMN_NAMES = new Set([
        'player',
        'player name',
        'playername',
        'member',
        'member name', 
        'membername',
        'alliance member',
        'alliancemember',
        'name',
        'username',
        'user name',
        'user',
        'ign',
        'in game name',
        'ingame name',
        'in-game name',
    ]);

    // Check if a column name exactly matches one of our player column patterns
    const isPlayerColumn = (columnName: string): boolean => {
        // Normalize: lowercase, trim, collapse spaces, remove hyphens
        const normalized = columnName.toLowerCase().trim().replace(/\s+/g, ' ').replace(/-/g, ' ');
        // Also check without spaces
        const noSpaces = normalized.replace(/\s/g, '');
        
        return PLAYER_COLUMN_NAMES.has(normalized) || PLAYER_COLUMN_NAMES.has(noSpaces);
    };

    // Derive column types for constrained selection
    const textColumns = columns.filter(c => !c.isNumeric);
    const numericColumns = columns.filter(c => c.isNumeric);
    const playerColumns = textColumns.filter(c => isPlayerColumn(c.name));

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setParseErrors([]);

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            analyzeFile(content);
        };
        reader.onerror = () => {
            setError("Failed to read file");
        };
        reader.readAsText(file);
    };

    const analyzeFile = (content: string) => {
        const result = analyzeCSV(content);
        
        if (result.error) {
            setError(result.error);
            return;
        }

        if (result.columns.length < 2) {
            setError("CSV must have at least 2 columns");
            return;
        }

        setCsvContent(content);
        setColumns(result.columns);
        setRowCount(result.rowCount);

        // Auto-select columns based on heuristics
        const textCols = result.columns.filter(c => !c.isNumeric);
        const numCols = result.columns.filter(c => c.isNumeric);
        const playerCols = textCols.filter(c => isPlayerColumn(c.name));

        // Player column: prefer columns that match player name patterns
        if (playerCols.length > 0) {
            setPlayerColumn(playerCols[0].index);
        } else {
            // No matching player columns - don't auto-select
            setPlayerColumn(null);
        }

        // Value column: prefer first numeric column
        if (numCols.length > 0) {
            setValueColumn(numCols[0].index);
        } else {
            setValueColumn(null);
        }

        setStep("map-columns");
    };

    const handleColumnMappingComplete = () => {
        if (playerColumn === null || valueColumn === null) {
            setError("Please select both a player column and a value column");
            return;
        }

        if (playerColumn === valueColumn) {
            setError("Player and value columns must be different");
            return;
        }

        setError(null);
        setStep("select-metric");
    };

    const handleMetricSelected = () => {
        if (!selectedMetricId) {
            setError("Please select a metric");
            return;
        }

        // Parse the CSV with the selected columns
        const { entries, errors } = parseCSV(csvContent, {
            nameColumn: playerColumn!,
            valueColumn: valueColumn!,
            hasHeader: true,
        });

        setParseErrors(errors);

        if (entries.length === 0) {
            setError(errors[0] ?? "No valid entries found in CSV");
            return;
        }

        const summary = matchEntriesToMembers(entries, members);
        setMatchSummary(summary);

        // Initialize duplicate selections
        const initialSelections: DuplicateSelections = {};
        summary.results.forEach((result, index) => {
            if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
                if (!(result.memberId in initialSelections)) {
                    initialSelections[result.memberId] = index;
                }
            }
        });
        setDuplicateSelections(initialSelections);

        setStep("preview");
    };

    const handleDuplicateSelection = (memberId: string, resultIndex: number) => {
        setDuplicateSelections(prev => ({
            ...prev,
            [memberId]: resultIndex,
        }));
    };

    const getEntriesToImport = () => {
        if (!matchSummary) return [];

        const selectedIndices = new Set(Object.values(duplicateSelections));
        
        return matchSummary.results
            .filter((result, index): result is MatchResult & { memberId: string } => {
                if (!result.memberId) return false;
                return selectedIndices.has(index);
            })
            .map((r) => ({
                memberId: r.memberId,
                value: r.value,
            }));
    };

    const handleImport = () => {
        if (!matchSummary) return;

        const entries = getEntriesToImport();
        if (entries.length === 0) {
            setError("No matched entries to import");
            return;
        }

        startTransition(async () => {
            try {
                const result = await importMemberMetrics({
                    periodId,
                    metricId: selectedMetricId,
                    allianceId,
                    entries,
                });
                setImportCount(result.count);
                setStep("complete");
            } catch (err) {
                setError(err instanceof Error ? err.message : "Import failed");
            }
        });
    };

    const handleReset = () => {
        setStep("upload");
        setCsvContent("");
        setColumns([]);
        setRowCount(0);
        setPlayerColumn(null);
        setValueColumn(null);
        setMatchSummary(null);
        setParseErrors([]);
        setError(null);
        setImportCount(0);
        setDuplicateSelections({});
    };

    const handleBack = () => {
        if (step === "map-columns") {
            handleReset();
        } else if (step === "select-metric") {
            setStep("map-columns");
            setError(null);
        } else if (step === "preview") {
            setStep("select-metric");
            setMatchSummary(null);
            setParseErrors([]);
            setError(null);
        }
    };

    // Precompute which memberIds have duplicates
    const membersWithDuplicates = useMemo(() => {
        if (!matchSummary) return new Set<string>();
        
        const counts = new Map<string, number>();
        for (const result of matchSummary.results) {
            if (result.memberId) {
                counts.set(result.memberId, (counts.get(result.memberId) || 0) + 1);
            }
        }
        
        const duplicates = new Set<string>();
        for (const [memberId, count] of counts) {
            if (count > 1) {
                duplicates.add(memberId);
            }
        }
        return duplicates;
    }, [matchSummary]);

    // Complete step
    if (step === "complete") {
        return (
            <div className="w-full max-w-2xl flex flex-col gap-4 items-center">
                <div className="p-6 rounded-lg bg-green-50 border border-green-200 text-center">
                    <h3 className="text-lg font-semibold text-green-800">Import Complete</h3>
                    <p className="text-green-700 mt-2">
                        Successfully imported {importCount} metric entries for {selectedMetric?.name}.
                    </p>
                </div>
                <button
                    onClick={handleReset}
                    className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                >
                    Import Another File
                </button>
            </div>
        );
    }

    // Map columns step
    if (step === "map-columns") {
        const selectedPlayerColumnName = playerColumn !== null ? columns[playerColumn]?.name : null;
        const selectedValueColumnName = valueColumn !== null ? columns[valueColumn]?.name : null;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Choose Which Columns to Import</h3>
                    <button
                        onClick={handleBack}
                        className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                <div className="p-4 rounded-md bg-blue-100 border border-blue-300">
                    <p className="text-blue-900 font-medium">
                        Your spreadsheet has {columns.length} columns and {rowCount} rows.
                    </p>
                    <p className="text-blue-800 text-sm mt-1">
                        Select which column contains <strong>player names</strong> and which contains the <strong>values</strong> you want to import.
                    </p>
                </div>

                {/* Column selection - moved above table for clarity */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                    <div>
                        <label htmlFor="player-column" className="block text-sm font-semibold text-gray-900 mb-2">
                            1. Player Names Column
                            <span className="font-normal text-gray-600 ml-1">(text)</span>
                        </label>
                        {playerColumns.length > 0 ? (
                            <>
                                <select
                                    id="player-column"
                                    value={playerColumn ?? ""}
                                    onChange={(e) => setPlayerColumn(parseInt(e.target.value))}
                                    className="w-full rounded-md border-2 border-purple-300 p-3 text-base text-gray-900 bg-white focus:border-purple-500 focus:ring-purple-500"
                                >
                                    <option value="" disabled>Select column...</option>
                                    {playerColumns.map((col) => (
                                        <option key={col.index} value={col.index}>
                                            {col.name}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-green-700 mt-1">
                                    Found {playerColumns.length} matching column{playerColumns.length > 1 ? 's' : ''}
                                </p>
                            </>
                        ) : (
                            <div className="p-3 rounded-md bg-amber-100 border border-amber-300">
                                <p className="text-sm text-amber-900 font-medium">
                                    No player name column found
                                </p>
                                <p className="text-xs text-amber-800 mt-1">
                                    Your spreadsheet needs a column named something like:
                                </p>
                                <p className="text-xs text-amber-800 mt-1 font-medium">
                                    Player, Player Name, Member, Member Name, Name, or Alliance Member
                                </p>
                            </div>
                        )}
                    </div>

                    <div>
                        <label htmlFor="value-column" className="block text-sm font-semibold text-gray-900 mb-2">
                            2. Values Column
                            <span className="font-normal text-gray-600 ml-1">(numeric)</span>
                        </label>
                        {numericColumns.length > 0 ? (
                            <>
                                <select
                                    id="value-column"
                                    value={valueColumn ?? ""}
                                    onChange={(e) => setValueColumn(parseInt(e.target.value))}
                                    className="w-full rounded-md border-2 border-green-300 p-3 text-base text-gray-900 bg-white focus:border-green-500 focus:ring-green-500"
                                >
                                    <option value="" disabled>Select column...</option>
                                    {numericColumns.map((col) => (
                                        <option key={col.index} value={col.index}>
                                            {col.name}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-green-700 mt-1">
                                    Found {numericColumns.length} numeric column{numericColumns.length > 1 ? 's' : ''}
                                </p>
                            </>
                        ) : (
                            <div className="p-3 rounded-md bg-amber-100 border border-amber-300">
                                <p className="text-sm text-amber-900 font-medium">
                                    No numeric columns found
                                </p>
                                <p className="text-xs text-amber-800 mt-1">
                                    Your spreadsheet needs at least one column with whole numbers (e.g., 1500, 2300).
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Data preview with highlighted columns */}
                <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Preview (first 3 rows):</p>
                    <div className="border rounded-md overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100">
                                <tr>
                                    {columns.map((col) => {
                                        const isPlayerCol = col.index === playerColumn;
                                        const isValueCol = col.index === valueColumn;
                                        return (
                                            <th 
                                                key={col.index} 
                                                className={`px-3 py-2 text-left font-semibold border-b-2 ${
                                                    isPlayerCol ? 'bg-purple-100 text-purple-900 border-purple-400' :
                                                    isValueCol ? 'bg-green-100 text-green-900 border-green-400' :
                                                    'text-gray-600 border-gray-200'
                                                }`}
                                            >
                                                {col.name}
                                                {isPlayerCol && <span className="ml-1 text-xs">(Player)</span>}
                                                {isValueCol && <span className="ml-1 text-xs">(Value)</span>}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {columns[0]?.sampleValues.slice(0, 3).map((_, rowIdx) => (
                                    <tr key={rowIdx}>
                                        {columns.map((col) => {
                                            const isPlayerCol = col.index === playerColumn;
                                            const isValueCol = col.index === valueColumn;
                                            return (
                                                <td 
                                                    key={col.index} 
                                                    className={`px-3 py-2 border-t truncate max-w-32 ${
                                                        isPlayerCol ? 'bg-purple-50 text-purple-900 font-medium' :
                                                        isValueCol ? 'bg-green-50 text-green-900 font-medium' :
                                                        'text-gray-500'
                                                    }`}
                                                >
                                                    {col.sampleValues[rowIdx] || '—'}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* What will be imported */}
                {playerColumns.length > 0 && numericColumns.length > 0 && selectedPlayerColumnName && selectedValueColumnName && playerColumn !== valueColumn && (
                    <div className="p-4 rounded-md bg-green-50 border border-green-300">
                        <p className="text-green-900 font-medium">Ready to continue</p>
                        <p className="text-green-800 text-sm mt-1">
                            Will import <strong>{selectedValueColumnName}</strong> for each player in <strong>{selectedPlayerColumnName}</strong>.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">
                        {error}
                    </div>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleBack}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleColumnMappingComplete}
                        disabled={playerColumns.length === 0 || numericColumns.length === 0 || playerColumn === null || valueColumn === null || playerColumn === valueColumn}
                        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next: Select Metric
                    </button>
                </div>
            </div>
        );
    }

    // Select metric step
    if (step === "select-metric") {
        const selectedValueColumnName = valueColumn !== null ? columns[valueColumn]?.name : null;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Choose Which Metric to Save As</h3>
                    <button
                        onClick={handleBack}
                        className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                        ← Back
                    </button>
                </div>

                <div className="p-4 rounded-md bg-blue-100 border border-blue-300">
                    <p className="text-blue-900">
                        You&apos;re importing <strong>{selectedValueColumnName}</strong> values.
                    </p>
                    <p className="text-blue-800 text-sm mt-1">
                        Select which metric these values should be saved as.
                    </p>
                </div>

                <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                    <label htmlFor="metric-select" className="block text-sm font-semibold text-gray-900 mb-2">
                        Save as Metric
                    </label>
                    <select
                        id="metric-select"
                        value={selectedMetricId}
                        onChange={(e) => setSelectedMetricId(e.target.value)}
                        className="w-full rounded-md border-2 border-blue-300 p-3 text-base text-gray-900 bg-white focus:border-blue-500"
                    >
                        {metrics.map((metric) => (
                            <option key={metric.id} value={metric.id}>{metric.name}</option>
                        ))}
                    </select>
                </div>

                {metrics.length === 0 && (
                    <div className="p-4 rounded-md bg-amber-100 border border-amber-300">
                        <p className="text-amber-900 font-medium">No metrics configured</p>
                        <p className="text-amber-800 text-sm mt-1">
                            Please add metrics to this period before importing.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">
                        {error}
                    </div>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleBack}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleMetricSelected}
                        disabled={!selectedMetricId || metrics.length === 0}
                        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next: Preview
                    </button>
                </div>
            </div>
        );
    }

    // Preview step
    if (step === "preview" && matchSummary) {
        const entriesToImport = getEntriesToImport();
        const hasDuplicates = matchSummary.duplicates > 0;
        const selectedValueColumnName = valueColumn !== null ? columns[valueColumn]?.name : null;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                        Review &amp; Confirm Import
                    </h3>
                    <button
                        onClick={handleBack}
                        className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                        ← Back
                    </button>
                </div>

                <div className="p-4 rounded-md bg-blue-100 border border-blue-300">
                    <p className="text-blue-900">
                        <strong>{selectedValueColumnName}</strong> → <strong>{selectedMetric?.name}</strong>
                    </p>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-4 rounded-md bg-gray-100 border border-gray-300">
                        <div className="text-2xl font-bold text-gray-900">{matchSummary.total}</div>
                        <div className="text-sm text-gray-700">Total Rows</div>
                    </div>
                    <div className="p-4 rounded-md bg-green-100 border border-green-300">
                        <div className="text-2xl font-bold text-green-900">{entriesToImport.length}</div>
                        <div className="text-sm text-green-800">Will Import</div>
                    </div>
                    <div className="p-4 rounded-md bg-red-100 border border-red-300">
                        <div className="text-2xl font-bold text-red-900">{matchSummary.unmatched}</div>
                        <div className="text-sm text-red-800">Unmatched</div>
                    </div>
                </div>

                {/* Duplicate Resolution Notice */}
                {hasDuplicates && (
                    <div className="p-4 rounded-md bg-amber-100 border border-amber-300">
                        <h4 className="font-semibold text-amber-900">Duplicates Found</h4>
                        <p className="text-sm text-amber-800 mt-1">
                            {matchSummary.duplicates} duplicate entries detected. 
                            Click &quot;Use This&quot; to choose which value to import for each member.
                        </p>
                    </div>
                )}

                {/* Parse Errors */}
                {parseErrors.length > 0 && (
                    <div className="p-4 rounded-md bg-orange-100 border border-orange-300">
                        <h4 className="font-semibold text-orange-900 mb-2">Parse Warnings ({parseErrors.length})</h4>
                        <ul className="text-sm text-orange-800 list-disc list-inside max-h-24 overflow-y-auto">
                            {parseErrors.map((err, i) => (
                                <li key={i}>{err}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Results Table */}
                <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-100">
                            <tr className="text-gray-900 font-semibold">
                                <th className="px-3 py-2 text-left">CSV Name</th>
                                <th className="px-3 py-2 text-left">Matched To</th>
                                <th className="px-3 py-2 text-right">Value</th>
                                <th className="px-3 py-2 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {matchSummary.results.map((result, i) => {
                                const memberHasDuplicates = result.memberId 
                                    ? membersWithDuplicates.has(result.memberId)
                                    : false;
                                
                                const isSelected = result.memberId 
                                    ? duplicateSelections[result.memberId] === i
                                    : false;
                                
                                const willImport = result.status !== "unmatched" && isSelected;
                                
                                return (
                                    <tr 
                                        key={i}
                                        className={
                                            result.status === "unmatched" ? "bg-red-50 text-gray-900" :
                                            !isSelected ? "bg-gray-50 text-gray-500" :
                                            "text-gray-900"
                                        }
                                    >
                                        <td className="px-3 py-2 border-t">{result.rawName}</td>
                                        <td className="px-3 py-2 border-t">
                                            {result.matchedName || "—"}
                                            {result.confidence > 0 && result.confidence < 1 && (
                                                <span className="ml-2 text-xs text-gray-600">
                                                    ({Math.round(result.confidence * 100)}%)
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 border-t text-right font-mono">{result.value}</td>
                                        <td className="px-3 py-2 border-t text-center">
                                            {result.status === "unmatched" ? (
                                                <span className="px-2 py-0.5 rounded text-xs bg-red-200 text-red-800">
                                                    No Match
                                                </span>
                                            ) : memberHasDuplicates ? (
                                                <button
                                                    onClick={() => result.memberId && handleDuplicateSelection(result.memberId, i)}
                                                    className={`px-2 py-1 rounded text-xs cursor-pointer ${
                                                        isSelected 
                                                            ? "bg-green-600 text-white" 
                                                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                                    }`}
                                                >
                                                    {isSelected ? "Selected" : "Use This"}
                                                </button>
                                            ) : willImport ? (
                                                <span className="px-2 py-0.5 rounded text-xs bg-green-200 text-green-800">
                                                    Will Import
                                                </span>
                                            ) : null}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {error && (
                    <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleBack}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={isPending || entriesToImport.length === 0}
                        className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? "Importing..." : `Import ${entriesToImport.length} Entries`}
                    </button>
                </div>
            </div>
        );
    }

    // Upload step
    return (
        <div className="w-full max-w-2xl flex flex-col gap-5">
            <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50 hover:bg-blue-100 transition-colors">
                <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="csv-upload"
                />
                <label 
                    htmlFor="csv-upload"
                    className="cursor-pointer flex flex-col items-center gap-3"
                >
                    <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-lg font-medium text-blue-900">Click to upload CSV file</span>
                    <span className="text-sm text-blue-700">Works with any spreadsheet export</span>
                </label>
            </div>

            {error && (
                <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">
                    {error}
                </div>
            )}

            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-3">How it works:</p>
                <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside">
                    <li>Upload any CSV with player data</li>
                    <li>Choose which column contains player names</li>
                    <li>Choose which numeric column to import</li>
                    <li>Select the metric to save it as</li>
                    <li>Preview and confirm</li>
                </ol>
            </div>

            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-3">Common column names:</p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-gray-700 font-medium mb-1">Player names:</p>
                        <p className="text-gray-600">Player, Player Name, Member, Member Name, Name, Alliance Member</p>
                    </div>
                    <div>
                        <p className="text-gray-700 font-medium mb-1">Metric values:</p>
                        <p className="text-gray-600">Kill Points, Score, Kills, Captures, Power, Points</p>
                    </div>
                </div>
            </div>

            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-3">Example CSV formats:</p>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-sm text-gray-700 mb-2">Simple (2 columns):</p>
                        <pre className="text-sm bg-white p-3 rounded border border-gray-300 text-gray-900">
{`Player,Kill Points
Dragon,1500
Phoenix,2300`}
                        </pre>
                    </div>
                    <div>
                        <p className="text-sm text-gray-700 mb-2">Complex (many columns):</p>
                        <pre className="text-sm bg-white p-3 rounded border border-gray-300 text-gray-900">
{`Rank,Member Name,Kills,Score
1,Dragon,1500,9500
2,Phoenix,2300,8200`}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}
