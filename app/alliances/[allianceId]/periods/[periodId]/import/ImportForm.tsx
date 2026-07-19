'use client'
import { useState, useTransition, useMemo } from "react";
import { analyzeCSV, parseCSV, matchEntriesToMembers, matchMetricName, type MatchSummary, type ColumnInfo } from "@/app/src/lib/memberMatcher";
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

// A numeric spreadsheet column and the period metric it will be imported as.
// metricId === null means "do not import this column". Kept as a typed array
// (rather than a bare record) so it is easy to inspect and, later, persist as a
// reusable saved mapping.
type ColumnMetricMapping = {
    columnIndex: number;
    columnName: string;
    metricId: string | null;
};

// Display-oriented view model for one mapped column, kept separate from the
// persistence shape (the server's MetricMapping) so presentation concerns never
// leak into what we write.
type MetricImportPreview = {
    metricId: string;
    metricName: string;
    columnName: string;
    summary: MatchSummary;
};

// Duplicate selections are tracked per metric, then per member: which result
// row supplies the value when a member appears multiple times in one column.
type DuplicateSelections = Record<string, Record<string, number>>;

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

// Rows selected to import for a single metric preview, honoring the user's
// per-member duplicate resolution.
function getPreviewEntries(
    preview: MetricImportPreview,
    selections: Record<string, number> | undefined,
): { memberId: string; value: number }[] {
    const selectedIndices = new Set(Object.values(selections ?? {}));
    return preview.summary.results
        .filter((result, index): result is typeof result & { memberId: string } => {
            if (!result.memberId) return false;
            return selectedIndices.has(index);
        })
        .map((r) => ({ memberId: r.memberId, value: r.value }));
}

export function ImportForm({ periodId, allianceId, members, metrics }: ImportFormProps) {
    const [step, setStep] = useState<ImportStep>("upload");
    const [csvContent, setCsvContent] = useState<string>("");
    const [rowCount, setRowCount] = useState(0);
    const [autoDetectedPlayerColumn, setAutoDetectedPlayerColumn] = useState<ColumnInfo | null>(null);
    const [numericColumns, setNumericColumns] = useState<ColumnInfo[]>([]);
    const [columnMappings, setColumnMappings] = useState<ColumnMetricMapping[]>([]);
    const [previews, setPreviews] = useState<MetricImportPreview[]>([]);
    const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelections>({});
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importResult, setImportResult] = useState<{ totalCount: number; perMetric: { metricId: string; count: number }[] } | null>(null);
    const [isPending, startTransition] = useTransition();

    const metricNameById = useMemo(() => {
        const map = new Map<string, string>();
        metrics.forEach((m) => map.set(m.id, m.name));
        return map;
    }, [metrics]);

    const mappedColumns = columnMappings.filter((m) => m.metricId !== null);

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

        // Auto-detect player column (required - must match known names)
        const textCols = result.columns.filter(c => !c.isNumeric);
        const playerCol = textCols.find(c => isPlayerColumn(c.name)) || null;

        const numCols = result.columns.filter(c => c.isNumeric);

        // Auto-map each numeric column to a metric by exact header match, never
        // assigning the same metric to two columns. Unmatched columns default to
        // "do not import" so the user opts in deliberately.
        const usedMetricIds = new Set<string>();
        const mappings: ColumnMetricMapping[] = numCols.map((col) => {
            const match = matchMetricName(col.name, metrics);
            let metricId: string | null = null;
            if (match.status === "matched" && match.metricId && !usedMetricIds.has(match.metricId)) {
                metricId = match.metricId;
                usedMetricIds.add(match.metricId);
            }
            return { columnIndex: col.index, columnName: col.name, metricId };
        });

        setCsvContent(content);
        setRowCount(result.rowCount);
        setAutoDetectedPlayerColumn(playerCol);
        setNumericColumns(numCols);
        setColumnMappings(mappings);
        setStep("select");
    };

    const setColumnMetric = (columnIndex: number, metricId: string | null) => {
        setColumnMappings((prev) =>
            prev.map((m) => (m.columnIndex === columnIndex ? { ...m, metricId } : m)),
        );
    };

    const handleSelectComplete = () => {
        if (!autoDetectedPlayerColumn || mappedColumns.length === 0) {
            return;
        }

        const nextPreviews: MetricImportPreview[] = [];
        const nextSelections: DuplicateSelections = {};
        const aggregatedErrors: string[] = [];

        for (const mapping of mappedColumns) {
            const metricId = mapping.metricId as string;
            const { entries, errors } = parseCSV(csvContent, {
                nameColumn: autoDetectedPlayerColumn.index,
                valueColumn: mapping.columnIndex,
                hasHeader: true,
            });

            errors.forEach((err) => aggregatedErrors.push(`${mapping.columnName}: ${err}`));

            const summary = matchEntriesToMembers(entries, members);

            const selections: Record<string, number> = {};
            summary.results.forEach((result, index) => {
                if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
                    if (!(result.memberId in selections)) {
                        selections[result.memberId] = index;
                    }
                }
            });

            nextPreviews.push({
                metricId,
                metricName: metricNameById.get(metricId) ?? mapping.columnName,
                columnName: mapping.columnName,
                summary,
            });
            nextSelections[metricId] = selections;
        }

        const totalParsed = nextPreviews.reduce((sum, p) => sum + p.summary.total, 0);
        const totalMatched = nextPreviews.reduce(
            (sum, p) => sum + getPreviewEntries(p, nextSelections[p.metricId]).length,
            0,
        );
        if (totalMatched === 0) {
            // Distinguish "nothing parsed" (blank/decimal values) from "parsed but
            // matched no member" so the message points at the real problem.
            setError(
                totalParsed === 0
                    ? "No valid values found to import. Values must be whole numbers - check for blanks or decimals in the mapped columns."
                    : "No rows matched any of your alliance members. Check the player names and try again.",
            );
            return;
        }

        setPreviews(nextPreviews);
        setDuplicateSelections(nextSelections);
        setParseErrors(aggregatedErrors);
        setError(null);
        setStep("preview");
    };

    const handleDuplicateSelection = (metricId: string, memberId: string, resultIndex: number) => {
        setDuplicateSelections((prev) => ({
            ...prev,
            [metricId]: { ...(prev[metricId] ?? {}), [memberId]: resultIndex },
        }));
    };

    const totalToImport = useMemo(
        () =>
            previews.reduce(
                (sum, p) => sum + getPreviewEntries(p, duplicateSelections[p.metricId]).length,
                0,
            ),
        [previews, duplicateSelections],
    );

    const handleImport = () => {
        const mappings = previews
            .map((preview) => ({
                metricId: preview.metricId,
                entries: getPreviewEntries(preview, duplicateSelections[preview.metricId]),
            }))
            .filter((m) => m.entries.length > 0);

        if (mappings.length === 0) {
            setError("No matched entries to import");
            return;
        }

        startTransition(async () => {
            try {
                const result = await importMemberMetrics({ periodId, allianceId, mappings });
                setImportResult({ totalCount: result.totalCount, perMetric: result.perMetric });
                setStep("complete");
            } catch (err) {
                setError(err instanceof Error ? err.message : "Import failed");
            }
        });
    };

    const handleReset = () => {
        setStep("upload");
        setCsvContent("");
        setRowCount(0);
        setAutoDetectedPlayerColumn(null);
        setNumericColumns([]);
        setColumnMappings([]);
        setPreviews([]);
        setDuplicateSelections({});
        setParseErrors([]);
        setError(null);
        setImportResult(null);
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

    // Complete step
    if (step === "complete" && importResult) {
        return (
            <div className="w-full max-w-2xl flex flex-col gap-4 items-center">
                <div className="w-full p-6 rounded-lg bg-green-50 border border-green-200">
                    <h3 className="text-lg font-semibold text-green-800 text-center">Import Complete</h3>
                    <ul className="mt-4 divide-y divide-green-200">
                        {importResult.perMetric.map((m) => (
                            <li key={m.metricId} className="flex items-center justify-between py-2 text-green-900">
                                <span>{metricNameById.get(m.metricId) ?? "Metric"}</span>
                                <span className="font-mono font-medium">{m.count}</span>
                            </li>
                        ))}
                        <li className="flex items-center justify-between py-2 font-semibold text-green-900 border-t-2 border-green-300">
                            <span>Total</span>
                            <span className="font-mono">{importResult.totalCount}</span>
                        </li>
                    </ul>
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

    // Select step - validate player column, map numeric columns to metrics
    if (step === "select") {
        const noMetrics = metrics.length === 0;
        const canProceed = Boolean(autoDetectedPlayerColumn) && numericColumns.length > 0 && !noMetrics && mappedColumns.length > 0;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Map Columns to Metrics</h3>
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
                {noMetrics && (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <p className="text-red-900 font-semibold">
                            No metrics configured for this period
                        </p>
                        <p className="text-sm text-red-800 mt-1">
                            Please add metrics to this evaluation period before importing data.
                        </p>
                    </div>
                )}

                {/* Mapping table */}
                {autoDetectedPlayerColumn && numericColumns.length > 0 && !noMetrics && (
                    <>
                        <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                            <p className="text-sm font-semibold text-gray-900 mb-1">
                                Choose which metric each column should be imported as
                            </p>
                            <p className="text-sm text-gray-600 mb-3">
                                We&apos;ve matched columns to metrics by name where we could. Set any column
                                to &quot;Do not import&quot; to skip it.
                            </p>
                            <div className="flex flex-col gap-3">
                                {columnMappings.map((mapping) => {
                                    // Prevent the same metric being mapped to two columns
                                    // by disabling metrics already chosen elsewhere.
                                    const usedElsewhere = new Set(
                                        columnMappings
                                            .filter((m) => m.columnIndex !== mapping.columnIndex && m.metricId)
                                            .map((m) => m.metricId as string),
                                    );
                                    return (
                                        <div key={mapping.columnIndex} className="flex items-center gap-3">
                                            <span className="w-2/5 truncate font-medium text-gray-900" title={mapping.columnName}>
                                                {mapping.columnName}
                                            </span>
                                            <span className="text-gray-400">→</span>
                                            <select
                                                aria-label={`Metric for ${mapping.columnName}`}
                                                value={mapping.metricId ?? ""}
                                                onChange={(e) => setColumnMetric(mapping.columnIndex, e.target.value || null)}
                                                className="flex-1 rounded-md border-2 border-gray-300 p-2 text-base text-gray-900 bg-white focus:border-blue-500"
                                            >
                                                <option value="">Do not import</option>
                                                {metrics.map((metric) => (
                                                    <option
                                                        key={metric.id}
                                                        value={metric.id}
                                                        disabled={usedElsewhere.has(metric.id)}
                                                    >
                                                        {metric.name}{usedElsewhere.has(metric.id) ? " (already mapped)" : ""}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Summary */}
                        {mappedColumns.length > 0 && (
                            <div className="p-4 rounded-md bg-blue-50 border border-blue-300">
                                <p className="text-blue-900 font-medium mb-1">
                                    Ready to import {mappedColumns.length} {mappedColumns.length === 1 ? "metric" : "metrics"}:
                                </p>
                                <ul className="text-blue-900 text-sm list-disc list-inside">
                                    <li>Player names from: <strong>{autoDetectedPlayerColumn.name}</strong></li>
                                    {mappedColumns.map((m) => (
                                        <li key={m.columnIndex}>
                                            <strong>{m.columnName}</strong> → <strong>{metricNameById.get(m.metricId as string)}</strong>
                                        </li>
                                    ))}
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
    if (step === "preview" && previews.length > 0) {
        return (
            <div className="w-full max-w-2xl flex flex-col gap-5">
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

                {/* Parse Errors (aggregated across all columns) */}
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

                {previews.map((preview) => (
                    <MetricPreviewSection
                        key={preview.metricId}
                        preview={preview}
                        selections={duplicateSelections[preview.metricId]}
                        onDuplicateSelection={handleDuplicateSelection}
                    />
                ))}

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
                        disabled={isPending || totalToImport === 0}
                        className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <span className="text-sm text-blue-700">Import several metrics from one spreadsheet</span>
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
                        <span>One or more numeric columns - map each to a metric on the next step</span>
                    </li>
                </ul>
            </div>

            <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-3">Example CSV:</p>
                <pre className="text-sm bg-white p-3 rounded border border-gray-300 text-gray-900">
{`Member Name,Kill Points,VS Score,Donations
Dragon,1500,2300,800
Phoenix,2300,2900,600
...`}
                </pre>
                <p className="text-sm text-gray-600 mt-2">
                    Bring every metric in one file - you&apos;ll map each column to a metric and import them together.
                </p>
            </div>
        </div>
    );
}

// One reviewable section per mapped metric. Mirrors the single-metric review
// table so each metric's matched / unmatched / duplicate rows stay easy to
// reason about instead of being merged into one dense grid.
function MetricPreviewSection({
    preview,
    selections,
    onDuplicateSelection,
}: {
    preview: MetricImportPreview;
    selections: Record<string, number> | undefined;
    onDuplicateSelection: (metricId: string, memberId: string, resultIndex: number) => void;
}) {
    const { summary } = preview;

    const membersWithDuplicates = useMemo(() => {
        const counts = new Map<string, number>();
        for (const result of summary.results) {
            if (result.memberId) {
                counts.set(result.memberId, (counts.get(result.memberId) || 0) + 1);
            }
        }
        const duplicates = new Set<string>();
        for (const [memberId, count] of counts) {
            if (count > 1) duplicates.add(memberId);
        }
        return duplicates;
    }, [summary]);

    const willImportCount = getPreviewEntries(preview, selections).length;
    const hasDuplicates = summary.duplicates > 0;

    return (
        <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-900">{preview.metricName}</h4>
                <span className="text-sm text-gray-600">
                    from <strong>{preview.columnName}</strong>
                </span>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-md bg-gray-100 border border-gray-300">
                    <div className="text-xl font-bold text-gray-900">{summary.total}</div>
                    <div className="text-xs text-gray-700">Total Rows</div>
                </div>
                <div className="p-3 rounded-md bg-green-100 border border-green-300">
                    <div className="text-xl font-bold text-green-900">{willImportCount}</div>
                    <div className="text-xs text-green-800">Will Import</div>
                </div>
                <div className="p-3 rounded-md bg-red-100 border border-red-300">
                    <div className="text-xl font-bold text-red-900">{summary.unmatched}</div>
                    <div className="text-xs text-red-800">Unmatched</div>
                </div>
            </div>

            {hasDuplicates && (
                <div className="p-3 rounded-md bg-amber-100 border border-amber-300">
                    <p className="text-sm text-amber-800">
                        {summary.duplicates} duplicate {summary.duplicates === 1 ? "entry" : "entries"} detected.
                        Click &quot;Use This&quot; to choose which value to import for each member.
                    </p>
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
                        {summary.results.map((result, i) => {
                            const memberHasDuplicates = result.memberId
                                ? membersWithDuplicates.has(result.memberId)
                                : false;
                            const isSelected = result.memberId
                                ? selections?.[result.memberId] === i
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
                                                onClick={() => result.memberId && onDuplicateSelection(preview.metricId, result.memberId, i)}
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
        </div>
    );
}
