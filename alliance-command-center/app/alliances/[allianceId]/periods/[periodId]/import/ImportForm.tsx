'use client'
import { useState, useTransition } from "react";
import { parseCSV, matchEntriesToMembers, matchMetricName, type MatchResult, type MatchSummary, type MetricMatchResult } from "@/app/src/lib/memberMatcher";
import { importMemberMetrics, createMetricAndImport } from "./action";

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

type ImportStep = "upload" | "metric-not-found" | "select-metric" | "confirm-create-metric" | "preview" | "complete";

type DuplicateSelection = {
    [memberId: string]: number; // maps memberId to the index in matchSummary.results
};

type ImportMode = "existing" | "create-new";

export function ImportForm({ periodId, allianceId, members, metrics }: ImportFormProps) {
    const [step, setStep] = useState<ImportStep>("upload");
    const [selectedMetricId, setSelectedMetricId] = useState(metrics[0]?.id || "");
    const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
    const [metricMatch, setMetricMatch] = useState<MetricMatchResult | null>(null);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importCount, setImportCount] = useState(0);
    const [isPending, startTransition] = useTransition();
    const [userOverrodeMetric, setUserOverrodeMetric] = useState(false);
    const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelection>({});
    const [createdMetricName, setCreatedMetricName] = useState<string | null>(null);
    const [importMode, setImportMode] = useState<ImportMode>("existing");

    const selectedMetric = metrics.find((m) => m.id === selectedMetricId);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setParseErrors([]);
        setMetricMatch(null);
        setUserOverrodeMetric(false);
        setDuplicateSelections({});
        setCreatedMetricName(null);

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
            setError("No valid entries found in CSV");
            return;
        }

        const summary = matchEntriesToMembers(entries, members);
        setMatchSummary(summary);

        // Initialize duplicate selections - default to first occurrence
        const initialSelections: DuplicateSelection = {};
        const seenMembers = new Map<string, number>();
        summary.results.forEach((result, index) => {
            if (result.status === "matched" && result.memberId) {
                if (!seenMembers.has(result.memberId)) {
                    seenMembers.set(result.memberId, index);
                    initialSelections[result.memberId] = index;
                }
            } else if (result.status === "duplicate" && result.memberId) {
                // Don't overwrite - keep first occurrence selected
            }
        });
        setDuplicateSelections(initialSelections);

        // Try to match the detected metric name to configured metrics
        if (detectedMetricName) {
            const metricMatchResult = matchMetricName(detectedMetricName, metrics);
            setMetricMatch(metricMatchResult);

            if (metricMatchResult.status === "unmatched") {
                // Metric not found - block and ask user what to do
                setStep("metric-not-found");
                return;
            }

            if (metricMatchResult.status === "matched" && metricMatchResult.metricId) {
                // Auto-select the matched metric
                setSelectedMetricId(metricMatchResult.metricId);
            }
        }

        setStep("preview");
    };

    const handleMetricOverride = (newMetricId: string) => {
        setSelectedMetricId(newMetricId);
        setUserOverrodeMetric(true);
    };

    const handleDuplicateSelection = (memberId: string, resultIndex: number) => {
        setDuplicateSelections(prev => ({
            ...prev,
            [memberId]: resultIndex,
        }));
    };

    const handleProceedToConfirmCreate = () => {
        setStep("confirm-create-metric");
    };

    const handleConfirmCreateMetric = () => {
        setImportMode("create-new");
        setStep("preview");
    };

    const handleProceedToSelectMetric = () => {
        setImportMode("existing");
        setStep("select-metric");
    };

    const handleMetricSelected = () => {
        if (!selectedMetricId) {
            setError("Please select a metric");
            return;
        }
        setUserOverrodeMetric(true);
        setStep("preview");
    };

    const handleConfirmCreateAndImport = () => {
        if (!matchSummary || !metricMatch?.detectedName) return;

        const validEntries = getSelectedEntries();
        if (validEntries.length === 0) {
            setError("No matched entries to import");
            return;
        }

        startTransition(async () => {
            try {
                const result = await createMetricAndImport({
                    periodId,
                    allianceId,
                    metricName: metricMatch.detectedName,
                    entries: validEntries,
                });
                setImportCount(result.count);
                setCreatedMetricName(result.metricName);
                setStep("complete");
            } catch (err) {
                setError(err instanceof Error ? err.message : "Import failed");
            }
        });
    };

    const getSelectedEntries = () => {
        if (!matchSummary) return [];

        // Get entries based on duplicate selections
        const selectedIndices = new Set(Object.values(duplicateSelections));
        
        return matchSummary.results
            .filter((result, index): result is MatchResult & { memberId: string } => {
                if (!result.memberId) return false;
                // Include if this is the selected index for this member
                return selectedIndices.has(index);
            })
            .map((r) => ({
                memberId: r.memberId,
                value: r.value,
            }));
    };

    const handleImport = () => {
        if (!matchSummary) return;

        const validEntries = getSelectedEntries();
        if (validEntries.length === 0) {
            setError("No matched entries to import");
            return;
        }

        startTransition(async () => {
            try {
                const result = await importMemberMetrics({
                    periodId,
                    metricId: selectedMetricId,
                    allianceId,
                    entries: validEntries,
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
        setUserOverrodeMetric(false);
        setDuplicateSelections({});
        setCreatedMetricName(null);
        setImportMode("existing");
    };

    // Group results by member for duplicate handling
    const getGroupedResults = () => {
        if (!matchSummary) return { groups: [], ungrouped: [] };

        const memberGroups = new Map<string, { indices: number[], results: MatchResult[] }>();
        const ungrouped: { index: number, result: MatchResult }[] = [];

        matchSummary.results.forEach((result, index) => {
            if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
                const existing = memberGroups.get(result.memberId);
                if (existing) {
                    existing.indices.push(index);
                    existing.results.push(result);
                } else {
                    memberGroups.set(result.memberId, { indices: [index], results: [result] });
                }
            } else {
                ungrouped.push({ index, result });
            }
        });

        return {
            groups: Array.from(memberGroups.entries()).map(([memberId, data]) => ({
                memberId,
                memberName: data.results[0].matchedName || "",
                entries: data.indices.map((idx, i) => ({
                    index: idx,
                    result: data.results[i],
                })),
                hasDuplicates: data.indices.length > 1,
            })),
            ungrouped,
        };
    };

    if (step === "complete") {
        return (
            <div className="w-full max-w-2xl flex flex-col gap-4 items-center">
                <div className="p-6 rounded-lg bg-green-50 border border-green-200 text-center">
                    <h3 className="text-lg font-semibold text-green-800">Import Complete</h3>
                    <p className="text-green-700 mt-2">
                        Successfully imported {importCount} metric entries for {createdMetricName || selectedMetric?.name}.
                    </p>
                    {createdMetricName && (
                        <p className="text-green-600 text-sm mt-1">
                            Created new metric: &quot;{createdMetricName}&quot;
                        </p>
                    )}
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

    if (step === "metric-not-found" && metricMatch) {
        const selectedCount = Object.keys(duplicateSelections).length;
        
        return (
            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-amber-800">Metric Not Configured</h3>
                    <button
                        onClick={handleReset}
                        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                <div className="p-4 rounded-md bg-amber-50 border border-amber-300">
                    <p className="text-amber-900">
                        The CSV file contains data for <strong>&quot;{metricMatch.detectedName}&quot;</strong>, 
                        but this metric is not configured for this period.
                    </p>
                    <p className="text-amber-800 text-sm mt-2">
                        You can import this data into an existing metric, or cancel and configure the metric first.
                    </p>
                </div>

                {matchSummary && (
                    <div className="p-3 rounded-md bg-gray-100 border border-gray-200">
                        <p className="text-sm text-gray-800">
                            Found <strong>{selectedCount}</strong> member matches ready to import
                            {matchSummary.unmatched > 0 && (
                                <span> ({matchSummary.unmatched} unmatched)</span>
                            )}
                        </p>
                    </div>
                )}

                {error && (
                    <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    {/* Primary action: use existing metric */}
                    {metrics.length > 0 && (
                        <button
                            onClick={handleProceedToSelectMetric}
                            className="w-full px-4 py-3 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer text-left"
                        >
                            <div className="font-medium">Choose Existing Metric</div>
                            <div className="text-sm text-blue-100">
                                Import this data into a metric already configured for this period
                            </div>
                        </button>
                    )}

                    <button
                        onClick={handleReset}
                        className="w-full px-4 py-3 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer text-left"
                    >
                        <div className="font-medium">Cancel Import</div>
                        <div className="text-sm text-gray-500">
                            Go back and configure the metric first, then re-import
                        </div>
                    </button>

                    {/* Secondary action: create new metric - separated with visual distinction */}
                    <div className="pt-3 border-t border-gray-200">
                        <p className="text-xs text-gray-500 mb-2">
                            Don&apos;t see the right metric? You can create a new one:
                        </p>
                        <button
                            onClick={handleProceedToConfirmCreate}
                            disabled={selectedCount === 0}
                            className="w-full px-4 py-3 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-left"
                        >
                            <div className="font-medium">Create New Metric...</div>
                            <div className="text-sm text-gray-500">
                                This will add a new metric definition to your alliance
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (step === "confirm-create-metric" && metricMatch) {
        const selectedCount = Object.keys(duplicateSelections).length;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Create New Metric</h3>
                    <button
                        onClick={handleReset}
                        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                <div className="p-4 rounded-md bg-amber-50 border border-amber-300">
                    <h4 className="font-medium text-amber-900">Are you sure you want to create a new metric?</h4>
                    <p className="text-amber-800 text-sm mt-2">
                        This will create a new metric called <strong>&quot;{metricMatch.detectedName}&quot;</strong> in your alliance&apos;s metric library and automatically add it to this period.
                    </p>
                </div>

                <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                    <h4 className="font-medium text-gray-900 mb-2">What this means:</h4>
                    <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                        <li>A new metric <strong>&quot;{metricMatch.detectedName}&quot;</strong> will be added to your alliance</li>
                        <li>The metric will be configured for this evaluation period</li>
                        <li><strong>{selectedCount}</strong> data entries will be imported</li>
                        <li>This metric will be available for future periods</li>
                    </ul>
                </div>

                <div className="p-3 rounded-md bg-blue-50 border border-blue-200">
                    <p className="text-sm text-blue-800">
                        <strong>Tip:</strong> If you&apos;re not sure this is the right metric name, go back and choose an existing metric instead.
                    </p>
                </div>

                {error && (
                    <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={() => setStep("metric-not-found")}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                        ← Back
                    </button>
                    <button
                        onClick={handleConfirmCreateMetric}
                        disabled={selectedCount === 0}
                        className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Yes, Create Metric & Continue
                    </button>
                </div>
            </div>
        );
    }

    if (step === "select-metric" && matchSummary) {
        const selectedCount = Object.keys(duplicateSelections).length;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Select Metric</h3>
                    <button
                        onClick={handleReset}
                        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                <div className="p-4 rounded-md bg-yellow-50 border border-yellow-300">
                    <p className="text-yellow-900">
                        CSV contains data for <strong>&quot;{metricMatch?.detectedName}&quot;</strong> which is not configured.
                    </p>
                    <p className="text-yellow-800 text-sm mt-2">
                        Select an existing metric to import this data into:
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
                            <strong>{selectedCount}</strong> entries will be imported
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
                        onClick={() => setStep("metric-not-found")}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                        ← Back
                    </button>
                    <button
                        onClick={handleMetricSelected}
                        disabled={!selectedMetricId || selectedCount === 0}
                        className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Continue to Preview
                    </button>
                </div>
            </div>
        );
    }

    if (step === "preview" && matchSummary) {
        const { groups, ungrouped } = getGroupedResults();
        const selectedCount = Object.keys(duplicateSelections).length;
        const hasUnresolvedDuplicates = groups.some(g => g.hasDuplicates);

        const isCreatingNewMetric = importMode === "create-new";
        const metricDisplayName = isCreatingNewMetric ? metricMatch?.detectedName : selectedMetric?.name;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">
                        Preview Import: {metricDisplayName}
                    </h3>
                    <button
                        onClick={handleReset}
                        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                        ← Start Over
                    </button>
                </div>

                {/* Creating New Metric Notice */}
                {isCreatingNewMetric && metricMatch && (
                    <div className="p-3 rounded-md bg-green-50 border border-green-200">
                        <h4 className="font-medium text-green-800">Creating New Metric</h4>
                        <p className="text-sm text-green-700 mt-1">
                            This will create a new metric called <strong>&quot;{metricMatch.detectedName}&quot;</strong> and add it to this period.
                        </p>
                        <button
                            onClick={() => setStep("confirm-create-metric")}
                            className="mt-2 text-sm text-green-600 hover:text-green-800 underline cursor-pointer"
                        >
                            ← Go back
                        </button>
                    </div>
                )}

                {/* Metric Detection Info - only show when not creating new */}
                {!isCreatingNewMetric && metricMatch && metricMatch.status === "matched" && !userOverrodeMetric && (
                    <div className="p-3 rounded-md bg-blue-50 border border-blue-200">
                        <h4 className="font-medium text-blue-800">Metric Detected</h4>
                        <p className="text-sm text-blue-700 mt-1">
                            CSV header &quot;{metricMatch.detectedName}&quot; matched to <strong>{metricMatch.metricName}</strong>
                            {metricMatch.confidence < 1 && (
                                <span className="text-blue-500"> ({Math.round(metricMatch.confidence * 100)}% match)</span>
                            )}
                        </p>
                        <div className="mt-2">
                            <label className="text-sm text-blue-700">Wrong metric?</label>
                            <select
                                value={selectedMetricId}
                                onChange={(e) => handleMetricOverride(e.target.value)}
                                className="ml-2 rounded-md border border-blue-300 p-1 text-sm text-black"
                            >
                                {metrics.map((metric) => (
                                    <option key={metric.id} value={metric.id}>{metric.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                {/* Manual Override - only show when not creating new */}
                {!isCreatingNewMetric && userOverrodeMetric && (
                    <div className="p-3 rounded-md bg-yellow-50 border border-yellow-300">
                        <h4 className="font-medium text-yellow-900">Importing as Different Metric</h4>
                        <p className="text-sm text-yellow-800 mt-1">
                            Importing as <strong>{selectedMetric?.name}</strong> (CSV header: &quot;{metricMatch?.detectedName}&quot;)
                        </p>
                        <select
                            value={selectedMetricId}
                            onChange={(e) => handleMetricOverride(e.target.value)}
                            className="mt-2 w-full rounded-md border border-yellow-400 p-2 text-sm text-gray-900 bg-white"
                        >
                            {metrics.map((metric) => (
                                <option key={metric.id} value={metric.id}>{metric.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => setStep("metric-not-found")}
                            className="mt-2 text-sm text-yellow-700 hover:text-yellow-900 underline cursor-pointer"
                        >
                            ← Choose a different option
                        </button>
                    </div>
                )}

                {/* Summary Stats */}
                <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-3 rounded-md bg-gray-200 border border-gray-300">
                        <div className="text-2xl font-bold text-gray-900">{matchSummary.total}</div>
                        <div className="text-xs text-gray-700">Total Rows</div>
                    </div>
                    <div className="p-3 rounded-md bg-green-100 border border-green-200">
                        <div className="text-2xl font-bold text-green-800">{selectedCount}</div>
                        <div className="text-xs text-green-700">Will Import</div>
                    </div>
                    <div className="p-3 rounded-md bg-red-100 border border-red-200">
                        <div className="text-2xl font-bold text-red-800">{matchSummary.unmatched}</div>
                        <div className="text-xs text-red-700">Unmatched</div>
                    </div>
                    <div className="p-3 rounded-md bg-yellow-100 border border-yellow-300">
                        <div className="text-2xl font-bold text-yellow-800">{matchSummary.duplicates}</div>
                        <div className="text-xs text-yellow-700">Duplicates</div>
                    </div>
                </div>

                {/* Duplicate Resolution Notice */}
                {hasUnresolvedDuplicates && (
                    <div className="p-3 rounded-md bg-yellow-50 border border-yellow-300">
                        <h4 className="font-medium text-yellow-900">Resolve Duplicates</h4>
                        <p className="text-sm text-yellow-800 mt-1">
                            Some members have multiple entries. Select which value to import for each.
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
                                <th className="px-3 py-2 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Grouped entries (matched members, potentially with duplicates) */}
                            {groups.map((group) => (
                                group.entries.map((entry) => {
                                    const isSelected = duplicateSelections[group.memberId] === entry.index;
                                    const showDuplicateSelector = group.hasDuplicates;
                                    
                                    return (
                                        <tr 
                                            key={entry.index}
                                            className={
                                                !isSelected && showDuplicateSelector ? "bg-gray-50 text-gray-500" :
                                                isSelected ? "bg-green-50 text-gray-900" : "text-gray-900"
                                            }
                                        >
                                            <td className="px-3 py-2 border-t">{entry.result.rawName}</td>
                                            <td className="px-3 py-2 border-t">
                                                {entry.result.matchedName}
                                                {entry.result.confidence > 0 && entry.result.confidence < 1 && (
                                                    <span className="ml-2 text-xs text-gray-600">
                                                        ({Math.round(entry.result.confidence * 100)}%)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 border-t text-right font-mono">{entry.result.value}</td>
                                            <td className="px-3 py-2 border-t text-center">
                                                {showDuplicateSelector ? (
                                                    <button
                                                        onClick={() => handleDuplicateSelection(group.memberId, entry.index)}
                                                        className={`px-2 py-1 rounded text-xs cursor-pointer ${
                                                            isSelected 
                                                                ? "bg-green-600 text-white" 
                                                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                                        }`}
                                                    >
                                                        {isSelected ? "Selected" : "Use This"}
                                                    </button>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded text-xs bg-green-200 text-green-800">
                                                        Will Import
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            ))}
                            
                            {/* Unmatched entries */}
                            {ungrouped.map(({ index, result }) => (
                                <tr key={index} className="bg-red-50 text-gray-900">
                                    <td className="px-3 py-2 border-t">{result.rawName}</td>
                                    <td className="px-3 py-2 border-t text-gray-500">—</td>
                                    <td className="px-3 py-2 border-t text-right font-mono">{result.value}</td>
                                    <td className="px-3 py-2 border-t text-center">
                                        <span className="px-2 py-0.5 rounded text-xs bg-red-200 text-red-800">
                                            No Match
                                        </span>
                                    </td>
                                </tr>
                            ))}
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
                    {isCreatingNewMetric ? (
                        <button
                            onClick={handleConfirmCreateAndImport}
                            disabled={isPending || selectedCount === 0}
                            className="px-4 py-2 rounded-md bg-green-500 text-white hover:bg-green-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? "Creating & Importing..." : `Create Metric & Import ${selectedCount} Entries`}
                        </button>
                    ) : (
                        <button
                            onClick={handleImport}
                            disabled={isPending || selectedCount === 0}
                            className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? "Importing..." : `Import ${selectedCount} Entries`}
                        </button>
                    )}
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
                <p className="text-xs mt-1 mb-2 text-gray-600">The header&apos;s second column should be the metric name (e.g., &quot;Kill Points&quot;)</p>
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
                    <p className="text-xs text-yellow-700 mt-1">
                        No metrics configured yet. You can create one during import.
                    </p>
                )}
            </div>
        </div>
    );
}
