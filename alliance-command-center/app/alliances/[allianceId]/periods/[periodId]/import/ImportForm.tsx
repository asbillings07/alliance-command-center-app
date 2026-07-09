'use client'
import { useState, useTransition, useMemo } from "react";
import { analyzeCSV, parseCSV, matchEntriesToMembers, type MatchResult, type MatchSummary, type ColumnInfo } from "@/app/src/lib/memberMatcher";
import { importMemberMetrics } from "./action";

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
    allianceId: string;
    members: MemberOption[];
    metrics: MetricOption[];
};

type ImportStep = "upload" | "select" | "preview" | "complete";

type DuplicateSelections = Record<string, number>;

// Recognized player column names (case-insensitive)
// Only add aliases that come from real spreadsheet exports
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
    'ign',
]);

function isPlayerColumn(columnName: string): boolean {
    const normalized = columnName.toLowerCase().trim().replace(/\s+/g, ' ').replace(/-/g, ' ');
    const noSpaces = normalized.replace(/\s/g, '');
    return PLAYER_COLUMN_NAMES.has(normalized) || PLAYER_COLUMN_NAMES.has(noSpaces);
}

export function ImportForm({ periodId, allianceId, members, metrics }: ImportFormProps) {
    const [step, setStep] = useState<ImportStep>("upload");
    const [csvContent, setCsvContent] = useState<string>("");
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [rowCount, setRowCount] = useState(0);
    const [autoDetectedPlayerColumn, setAutoDetectedPlayerColumn] = useState<ColumnInfo | null>(null);
    const [valueColumn, setValueColumn] = useState<number | null>(null);
    const [selectedMetricId, setSelectedMetricId] = useState(metrics[0]?.id || "");
    const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importCount, setImportCount] = useState(0);
    const [isPending, startTransition] = useTransition();
    const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelections>({});

    const selectedMetric = metrics.find((m) => m.id === selectedMetricId);
    const numericColumns = columns.filter(c => c.isNumeric);
    const selectedValueColumnName = valueColumn !== null ? columns[valueColumn]?.name : null;

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

        // Auto-detect player column (required - must match known names)
        const textCols = result.columns.filter(c => !c.isNumeric);
        const playerCol = textCols.find(c => isPlayerColumn(c.name));
        setAutoDetectedPlayerColumn(playerCol || null);

        // Auto-select first numeric column
        const numCols = result.columns.filter(c => c.isNumeric);
        if (numCols.length > 0) {
            setValueColumn(numCols[0].index);
        } else {
            setValueColumn(null);
        }

        setStep("select");
    };

    const handleSelectComplete = () => {
        if (!autoDetectedPlayerColumn || valueColumn === null || !selectedMetricId) {
            return;
        }

        // Parse the CSV with the detected player column and selected value column
        const { entries, errors } = parseCSV(csvContent, {
            nameColumn: autoDetectedPlayerColumn.index,
            valueColumn: valueColumn,
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
        setAutoDetectedPlayerColumn(null);
        setValueColumn(null);
        setMatchSummary(null);
        setParseErrors([]);
        setError(null);
        setImportCount(0);
        setDuplicateSelections({});
    };

    const handleBack = () => {
        if (step === "select") {
            handleReset();
        } else if (step === "preview") {
            setStep("select");
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
                    className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                    Import Another File
                </button>
            </div>
        );
    }

    // Select step - validate player column, choose value column and metric
    if (step === "select") {
        const canProceed = autoDetectedPlayerColumn && numericColumns.length > 0 && valueColumn !== null && selectedMetricId && metrics.length > 0;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Configure Import</h3>
                    <button
                        onClick={handleBack}
                        className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                {/* Player Column Status */}
                {autoDetectedPlayerColumn ? (
                    <div className="p-4 rounded-md bg-green-50 border border-green-300">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <p className="text-green-900 font-medium">
                                Player column found: <strong>{autoDetectedPlayerColumn.name}</strong>
                            </p>
                        </div>
                        <p className="text-green-800 text-sm mt-1 ml-7">
                            {rowCount} rows detected
                        </p>
                    </div>
                ) : (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <p className="text-red-900 font-semibold">
                                No player column found
                            </p>
                        </div>
                        <p className="text-sm text-red-800 mt-2 ml-7">
                            Please rename a column in your spreadsheet to one of these:
                        </p>
                        <ul className="text-sm text-red-800 mt-1 ml-7 list-disc list-inside">
                            <li><strong>Player</strong> or <strong>Player Name</strong></li>
                            <li><strong>Member</strong> or <strong>Member Name</strong></li>
                            <li><strong>Name</strong>, <strong>IGN</strong>, or <strong>Alliance Member</strong></li>
                        </ul>
                    </div>
                )}

                {/* Numeric columns check */}
                {numericColumns.length === 0 && (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <p className="text-red-900 font-semibold">
                            No numeric columns found
                        </p>
                        <p className="text-sm text-red-800 mt-1">
                            Your spreadsheet needs at least one column with whole numbers.
                        </p>
                    </div>
                )}

                {/* No metrics configured check */}
                {metrics.length === 0 && (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <p className="text-red-900 font-semibold">
                            No metrics configured for this period
                        </p>
                        <p className="text-sm text-red-800 mt-1">
                            Please add metrics to this evaluation period before importing data.
                        </p>
                    </div>
                )}

                {/* Only show selection if we have a player column and numeric columns */}
                {autoDetectedPlayerColumn && numericColumns.length > 0 && (
                    <>
                        {/* Question 1: Which column has the values? */}
                        <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                            <label htmlFor="value-column" className="block text-sm font-semibold text-gray-900 mb-1">
                                1. Which column contains the values you want to import?
                            </label>
                            <p className="text-sm text-gray-600 mb-3">
                                {numericColumns.length === 1 
                                    ? "Found 1 numeric column in your spreadsheet."
                                    : `Found ${numericColumns.length} numeric columns. We've pre-selected one, but choose the one you want.`
                                }
                            </p>
                            <select
                                id="value-column"
                                value={valueColumn ?? ""}
                                onChange={(e) => setValueColumn(parseInt(e.target.value))}
                                className="w-full rounded-md border-2 border-gray-300 p-3 text-base text-gray-900 bg-white focus:border-blue-500"
                            >
                                {numericColumns.map((col) => (
                                    <option key={col.index} value={col.index}>
                                        {col.name}
                                    </option>
                                ))}
                            </select>
                            {numericColumns.length > 1 && (
                                <p className="text-xs text-gray-500 mt-2">
                                    Available: {numericColumns.map(c => c.name).join(', ')}
                                </p>
                            )}
                        </div>

                        {/* Question 2: Which metric to save as? */}
                        {metrics.length > 0 ? (
                            <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                                <label htmlFor="metric-select" className="block text-sm font-semibold text-gray-900 mb-2">
                                    2. Which metric should these values be saved as?
                                </label>
                                <select
                                    id="metric-select"
                                    value={selectedMetricId}
                                    onChange={(e) => setSelectedMetricId(e.target.value)}
                                    className="w-full rounded-md border-2 border-gray-300 p-3 text-base text-gray-900 bg-white focus:border-blue-500"
                                >
                                    {metrics.map((metric) => (
                                        <option key={metric.id} value={metric.id}>{metric.name}</option>
                                    ))}
                                </select>
                            </div>
                        ) : null}

                        {/* Summary */}
                        {autoDetectedPlayerColumn && selectedValueColumnName && selectedMetric && (
                            <div className="p-4 rounded-md bg-blue-50 border border-blue-300">
                                <p className="text-blue-900 font-medium mb-1">Ready to import:</p>
                                <ul className="text-blue-900 text-sm list-disc list-inside">
                                    <li>Player names from: <strong>{autoDetectedPlayerColumn.name}</strong></li>
                                    <li>Values from: <strong>{selectedValueColumnName}</strong> → <strong>{selectedMetric.name}</strong></li>
                                </ul>
                            </div>
                        )}
                    </>
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
                        onClick={handleSelectComplete}
                        disabled={!canProceed}
                        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Preview Import
                    </button>
                </div>
            </div>
        );
    }

    // Preview step
    if (step === "preview" && matchSummary) {
        const entriesToImport = getEntriesToImport();
        const hasDuplicates = matchSummary.duplicates > 0;

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
                                            result.status === "unmatched" ? "bg-red-100 text-red-900" :
                                            !isSelected ? "bg-gray-100 text-gray-500" :
                                            "bg-green-50 text-green-900"
                                        }
                                    >
                                        <td className="px-3 py-2 border-t font-medium">{result.rawName}</td>
                                        <td className="px-3 py-2 border-t">
                                            {result.matchedName || "—"}
                                            {result.confidence > 0 && result.confidence < 1 && (
                                                <span className={`ml-2 text-xs ${willImport ? 'text-green-700' : 'text-gray-500'}`}>
                                                    ({Math.round(result.confidence * 100)}%)
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 border-t text-right font-mono font-medium">{result.value}</td>
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
                <p className="font-semibold text-gray-900 mb-3">Requirements:</p>
                <ul className="space-y-2 text-sm text-gray-700">
                    <li className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">✓</span>
                        <span>A column named <strong>Player</strong>, <strong>Member</strong>, <strong>Name</strong>, or <strong>IGN</strong></span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">✓</span>
                        <span>At least one numeric column with whole numbers</span>
                    </li>
                </ul>
            </div>

            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-3">Example CSV:</p>
                <pre className="text-sm bg-white p-3 rounded border border-gray-300 text-gray-900">
{`Member Name,Kill Points,Captures,Score
Dragon,1500,800,2300
Phoenix,2300,600,2900
...`}
                </pre>
            </div>
        </div>
    );
}
