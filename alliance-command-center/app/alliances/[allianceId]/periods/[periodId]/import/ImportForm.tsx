'use client'
import { useState, useTransition } from "react";
import { parseCSV, matchEntriesToMembers, matchMetricName, type MatchResult, type MatchSummary, type MetricMatchResult } from "@/app/src/lib/memberMatcher";
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

type ImportStep = "upload" | "metric-not-found" | "preview" | "complete";

// Maps memberId to the index in matchSummary.results that should be imported
type DuplicateSelections = Record<string, number>;

export function ImportForm({ periodId, allianceId, members, metrics }: ImportFormProps) {
    const [step, setStep] = useState<ImportStep>("upload");
    const [selectedMetricId, setSelectedMetricId] = useState(metrics[0]?.id || "");
    const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
    const [metricMatch, setMetricMatch] = useState<MetricMatchResult | null>(null);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importCount, setImportCount] = useState(0);
    const [isPending, startTransition] = useTransition();
    const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelections>({});

    const selectedMetric = metrics.find((m) => m.id === selectedMetricId);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setParseErrors([]);
        setMetricMatch(null);
        setDuplicateSelections({});

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            processCSV(content);
        };
        reader.onerror = () => {
            setError("Failed to read file");
        };
        reader.readAsText(file);
    };

    const processCSV = (content: string) => {
        const { entries, errors, detectedMetricName } = parseCSV(content, {
            nameColumn: 0,
            valueColumn: 1,
            hasHeader: true,
        });

        setParseErrors(errors);

        if (entries.length === 0) {
            setError(errors[0] ?? "No valid entries found in CSV");
            return;
        }

        const summary = matchEntriesToMembers(entries, members);
        setMatchSummary(summary);

        // Initialize duplicate selections - default to first occurrence for each member
        const initialSelections: DuplicateSelections = {};
        summary.results.forEach((result, index) => {
            if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
                if (!(result.memberId in initialSelections)) {
                    initialSelections[result.memberId] = index;
                }
            }
        });
        setDuplicateSelections(initialSelections);

        // Try to match the detected metric name to configured metrics (exact match after normalization)
        if (detectedMetricName) {
            const metricMatchResult = matchMetricName(detectedMetricName, metrics);
            setMetricMatch(metricMatchResult);

            if (metricMatchResult.status === "unmatched") {
                setStep("metric-not-found");
                return;
            }

            if (metricMatchResult.status === "matched" && metricMatchResult.metricId) {
                setSelectedMetricId(metricMatchResult.metricId);
            }
        }

        setStep("preview");
    };

    const handleMetricSelected = () => {
        if (!selectedMetricId) {
            setError("Please select a metric");
            return;
        }
        setStep("preview");
    };

    const handleDuplicateSelection = (memberId: string, resultIndex: number) => {
        setDuplicateSelections(prev => ({
            ...prev,
            [memberId]: resultIndex,
        }));
    };

    // Get entries to import based on duplicate selections
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
        setMatchSummary(null);
        setMetricMatch(null);
        setParseErrors([]);
        setError(null);
        setImportCount(0);
        setDuplicateSelections({});
    };

    // Helper to check if a member has duplicates
    const getMemberDuplicateInfo = (memberId: string) => {
        if (!matchSummary) return { hasDuplicates: false, indices: [] };
        
        const indices: number[] = [];
        matchSummary.results.forEach((result, index) => {
            if (result.memberId === memberId) {
                indices.push(index);
            }
        });
        
        return {
            hasDuplicates: indices.length > 1,
            indices,
        };
    };

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

    // Metric not found step
    if (step === "metric-not-found" && metricMatch) {
        const entriesToImport = getEntriesToImport();
        
        return (
            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-amber-800">Metric Not Found</h3>
                    <button
                        onClick={handleReset}
                        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                <div className="p-4 rounded-md bg-amber-50 border border-amber-300">
                    <p className="text-amber-900">
                        The CSV header contains <strong>&quot;{metricMatch.detectedName}&quot;</strong>, 
                        but no metric with that exact name is configured for this period.
                    </p>
                    <p className="text-amber-800 text-sm mt-2">
                        Please select an existing metric to import this data into, or cancel and configure the metric first.
                    </p>
                </div>

                <div>
                    <label htmlFor="metric-select" className="block text-sm font-medium text-gray-900 mb-2">
                        Choose Metric
                    </label>
                    <select
                        id="metric-select"
                        value={selectedMetricId}
                        onChange={(e) => setSelectedMetricId(e.target.value)}
                        className="w-full rounded-md border border-gray-300 p-3 text-base text-gray-900 bg-white"
                    >
                        {metrics.map((metric) => (
                            <option key={metric.id} value={metric.id}>{metric.name}</option>
                        ))}
                    </select>
                </div>

                {matchSummary && (
                    <div className="p-3 rounded-md bg-gray-100 border border-gray-200">
                        <p className="text-sm text-gray-800">
                            <strong>{entriesToImport.length}</strong> entries will be imported
                            {matchSummary.unmatched > 0 && (
                                <span> ({matchSummary.unmatched} unmatched members will be skipped)</span>
                            )}
                        </p>
                    </div>
                )}

                {error && (
                    <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleMetricSelected}
                        disabled={!selectedMetricId || entriesToImport.length === 0}
                        className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Continue to Preview
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
                        Preview Import: {selectedMetric?.name}
                    </h3>
                    <button
                        onClick={handleReset}
                        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                {/* Metric Match Info */}
                {metricMatch && metricMatch.status === "matched" && (
                    <div className="p-3 rounded-md bg-blue-50 border border-blue-200">
                        <p className="text-sm text-blue-800">
                            CSV metric <strong>&quot;{metricMatch.detectedName}&quot;</strong> matched to <strong>{metricMatch.metricName}</strong>
                        </p>
                    </div>
                )}

                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-3 rounded-md bg-gray-200 border border-gray-300">
                        <div className="text-2xl font-bold text-gray-900">{matchSummary.total}</div>
                        <div className="text-xs text-gray-700">Total Rows</div>
                    </div>
                    <div className="p-3 rounded-md bg-green-100 border border-green-200">
                        <div className="text-2xl font-bold text-green-800">{entriesToImport.length}</div>
                        <div className="text-xs text-green-700">Will Import</div>
                    </div>
                    <div className="p-3 rounded-md bg-red-100 border border-red-200">
                        <div className="text-2xl font-bold text-red-800">{matchSummary.unmatched}</div>
                        <div className="text-xs text-red-700">Unmatched</div>
                    </div>
                </div>

                {/* Duplicate Resolution Notice */}
                {hasDuplicates && (
                    <div className="p-3 rounded-md bg-yellow-50 border border-yellow-300">
                        <h4 className="font-medium text-yellow-900">Duplicates Found</h4>
                        <p className="text-sm text-yellow-800 mt-1">
                            {matchSummary.duplicates} duplicate entries detected. 
                            Click &quot;Use This&quot; to choose which value to import for each member.
                        </p>
                    </div>
                )}

                {/* Parse Errors */}
                {parseErrors.length > 0 && (
                    <div className="p-3 rounded-md bg-orange-50 border border-orange-200">
                        <h4 className="font-medium text-orange-800 mb-2">Parse Warnings ({parseErrors.length})</h4>
                        <ul className="text-sm text-orange-700 list-disc list-inside max-h-24 overflow-y-auto">
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
                                const { hasDuplicates: memberHasDuplicates } = result.memberId 
                                    ? getMemberDuplicateInfo(result.memberId)
                                    : { hasDuplicates: false };
                                
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
                    <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={isPending || entriesToImport.length === 0}
                        className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? "Importing..." : `Import ${entriesToImport.length} Entries`}
                    </button>
                </div>
            </div>
        );
    }

    // Upload step
    return (
        <div className="w-full max-w-2xl flex flex-col gap-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="csv-upload"
                />
                <label 
                    htmlFor="csv-upload"
                    className="cursor-pointer flex flex-col items-center gap-2"
                >
                    <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-gray-700">Click to upload CSV file</span>
                    <span className="text-xs text-gray-500">Expected format: name, value</span>
                </label>
            </div>

            {error && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                </div>
            )}

            <div className="text-sm text-gray-700 bg-gray-100 p-3 rounded-md border border-gray-200">
                <strong className="text-gray-900">CSV Format:</strong>
                <p className="text-xs mt-1 mb-2 text-gray-600">
                    The header&apos;s second column must match the metric name exactly (case-insensitive)
                </p>
                <pre className="text-xs bg-white p-2 rounded border text-gray-800">
{`name,Kill Points
PlayerOne,1500
PlayerTwo,2300
...`}
                </pre>
            </div>

            <div className="text-sm text-gray-700 bg-gray-100 p-3 rounded-md border border-gray-200">
                <strong className="text-gray-900">Configured Metrics for this Period:</strong>
                <ul className="mt-1 list-disc list-inside text-xs text-gray-700">
                    {metrics.map((metric) => (
                        <li key={metric.id}>{metric.name}</li>
                    ))}
                </ul>
                {metrics.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                        No metrics configured yet. Please add metrics to this period before importing.
                    </p>
                )}
            </div>
        </div>
    );
}
