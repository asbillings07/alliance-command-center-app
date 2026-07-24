'use client'
import { useState, useTransition, useMemo } from "react";
import { analyzeCSV, parseCSV, matchEntriesToMembers, matchMetricName, type MatchSummary, type ColumnInfo } from "@/app/src/lib/memberMatcher";
import { TourButton } from "@/app/src/components/client";
import { smartImportTour } from "@/app/src/lib/tours";
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
    periodName: string;
    allianceId: string;
    members: MemberOption[];
    // Metrics already attached to this period.
    metrics: MetricOption[];
    // Alliance library metrics not yet on this period (attachable).
    libraryMetrics: MetricOption[];
    canCreateMetrics: boolean;
    canAttachMetrics: boolean;
};

type ImportStep = "upload" | "select" | "preview" | "complete";

// How a column resolves. "existing" = already on the period; "attach" = a
// library metric to add to the period; "create" = a brand-new metric; "skip" =
// don't import. On the wire, existing/attach both send { kind: "existing" } and
// the server decides whether an attach is needed; create sends { kind: "create" }.
type ColumnTarget =
    | { kind: "skip" }
    | { kind: "existing"; metricId: string }
    | { kind: "attach"; metricId: string }
    | { kind: "create"; name: string };

type ColumnMetricMapping = {
    columnIndex: number;
    columnName: string;
    target: ColumnTarget;
};

type MetricDisposition = "existing" | "attach" | "create";

// Display view-model for one mapped column, keyed by column so a not-yet-created
// metric (no id) still has a stable key. Kept separate from the wire payload.
type MetricImportPreview = {
    columnIndex: number;
    columnName: string;
    displayName: string;
    disposition: MetricDisposition;
    target: ColumnTarget;
    summary: MatchSummary;
};

// Per column, then per member: which result row supplies the value.
type DuplicateSelections = Record<number, Record<string, number>>;

type WireMapping = Parameters<typeof importMemberMetrics>[0]["mappings"][number];
type ImportResult = Awaited<ReturnType<typeof importMemberMetrics>>;

const PLAYER_COLUMN_NAMES = new Set([
    'player', 'player name', 'playername', 'member', 'member name',
    'membername', 'alliance member', 'alliancemember', 'name', 'ign',
]);

function isPlayerColumn(columnName: string): boolean {
    const normalized = columnName.toLowerCase().trim().replace(/\s+/g, ' ').replace(/-/g, ' ');
    const noSpaces = normalized.replace(/\s/g, '');
    return PLAYER_COLUMN_NAMES.has(normalized) || PLAYER_COLUMN_NAMES.has(noSpaces);
}

const DISPOSITION_BADGE: Record<MetricDisposition, { label: string; className: string }> = {
    existing: { label: "On period", className: "bg-gray-200 text-gray-700" },
    attach: { label: "Add to period", className: "bg-blue-200 text-blue-800" },
    create: { label: "New metric", className: "bg-purple-200 text-purple-800" },
};

function targetToToken(target: ColumnTarget): string {
    switch (target.kind) {
        case "skip": return "";
        case "existing": return `existing:${target.metricId}`;
        case "attach": return `attach:${target.metricId}`;
        case "create": return "create";
    }
}

function tokenToTarget(token: string, columnName: string): ColumnTarget {
    if (token === "") return { kind: "skip" };
    if (token === "create") return { kind: "create", name: columnName };
    const [kind, metricId] = token.split(":");
    if (kind === "existing" && metricId) return { kind: "existing", metricId };
    if (kind === "attach" && metricId) return { kind: "attach", metricId };
    return { kind: "skip" };
}

function toWireTarget(target: ColumnTarget): WireMapping["target"] {
    if (target.kind === "create") return { kind: "create", name: target.name };
    if (target.kind === "existing" || target.kind === "attach") {
        return { kind: "existing", metricId: target.metricId };
    }
    throw new Error("Cannot send a skipped column");
}

// Rows selected to import for one preview, honoring duplicate resolution.
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

export function ImportForm({ periodId, periodName, allianceId, members, metrics, libraryMetrics, canCreateMetrics, canAttachMetrics }: ImportFormProps) {
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
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [isPending, startTransition] = useTransition();

    const metricNameById = useMemo(() => {
        const map = new Map<string, string>();
        [...metrics, ...libraryMetrics].forEach((m) => map.set(m.id, m.name));
        return map;
    }, [metrics, libraryMetrics]);

    // No metrics anywhere to choose from and no ability to create one.
    const noSelectableMetrics =
        metrics.length === 0 && libraryMetrics.length === 0 && !canCreateMetrics;

    const mappedColumns = columnMappings.filter((m) => m.target.kind !== "skip");

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);
        setParseErrors([]);
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result;
            // readAsText yields a string, but guard against an aborted read or a
            // non-string result rather than feeding an invalid value to analyzeCSV.
            if (typeof result !== "string") {
                setError("Failed to read file");
                return;
            }
            analyzeFile(result);
        };
        reader.onerror = () => setError("Failed to read file");
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

        const textCols = result.columns.filter(c => !c.isNumeric);
        const playerCol = textCols.find(c => isPlayerColumn(c.name)) || null;
        const numCols = result.columns.filter(c => c.isNumeric);

        // Auto-classify conservatively: reuse a metric already on the period,
        // else attach a library metric with the same name; never auto-create.
        const usedMetricIds = new Set<string>();
        const mappings: ColumnMetricMapping[] = numCols.map((col) => {
            const onPeriod = matchMetricName(col.name, metrics);
            if (onPeriod.status === "matched" && onPeriod.metricId && !usedMetricIds.has(onPeriod.metricId)) {
                usedMetricIds.add(onPeriod.metricId);
                return { columnIndex: col.index, columnName: col.name, target: { kind: "existing", metricId: onPeriod.metricId } };
            }
            if (canAttachMetrics) {
                const inLibrary = matchMetricName(col.name, libraryMetrics);
                if (inLibrary.status === "matched" && inLibrary.metricId && !usedMetricIds.has(inLibrary.metricId)) {
                    usedMetricIds.add(inLibrary.metricId);
                    return { columnIndex: col.index, columnName: col.name, target: { kind: "attach", metricId: inLibrary.metricId } };
                }
            }
            return { columnIndex: col.index, columnName: col.name, target: { kind: "skip" } };
        });

        setCsvContent(content);
        setRowCount(result.rowCount);
        setAutoDetectedPlayerColumn(playerCol);
        setNumericColumns(numCols);
        setColumnMappings(mappings);
        setStep("select");
    };

    const setColumnTarget = (columnIndex: number, token: string, columnName: string) => {
        setColumnMappings((prev) =>
            prev.map((m) => (m.columnIndex === columnIndex ? { ...m, target: tokenToTarget(token, columnName) } : m)),
        );
    };

    const displayNameFor = (target: ColumnTarget, columnName: string): string => {
        if (target.kind === "existing" || target.kind === "attach") {
            return metricNameById.get(target.metricId) ?? columnName;
        }
        if (target.kind === "create") return target.name;
        return columnName;
    };

    const handleSelectComplete = () => {
        if (!autoDetectedPlayerColumn || mappedColumns.length === 0) return;

        const nextPreviews: MetricImportPreview[] = [];
        const nextSelections: DuplicateSelections = {};
        const aggregatedErrors: string[] = [];

        for (const mapping of mappedColumns) {
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
                    if (!(result.memberId in selections)) selections[result.memberId] = index;
                }
            });

            nextPreviews.push({
                columnIndex: mapping.columnIndex,
                columnName: mapping.columnName,
                displayName: displayNameFor(mapping.target, mapping.columnName),
                disposition: mapping.target.kind === "skip" ? "existing" : mapping.target.kind,
                target: mapping.target,
                summary,
            });
            nextSelections[mapping.columnIndex] = selections;
        }

        const totalParsed = nextPreviews.reduce((sum, p) => sum + p.summary.total, 0);
        const totalMatched = nextPreviews.reduce(
            (sum, p) => sum + getPreviewEntries(p, nextSelections[p.columnIndex]).length,
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

    const handleDuplicateSelection = (columnIndex: number, memberId: string, resultIndex: number) => {
        setDuplicateSelections((prev) => ({
            ...prev,
            [columnIndex]: { ...(prev[columnIndex] ?? {}), [memberId]: resultIndex },
        }));
    };

    const totalToImport = useMemo(
        () => previews.reduce((sum, p) => sum + getPreviewEntries(p, duplicateSelections[p.columnIndex]).length, 0),
        [previews, duplicateSelections],
    );

    const handleImport = () => {
        const mappings: WireMapping[] = previews
            .map((preview) => ({
                target: toWireTarget(preview.target),
                entries: getPreviewEntries(preview, duplicateSelections[preview.columnIndex]),
            }))
            .filter((m) => m.entries.length > 0);

        if (mappings.length === 0) {
            setError("No matched entries to import");
            return;
        }

        startTransition(async () => {
            try {
                const result = await importMemberMetrics({ periodId, allianceId, mappings });
                setImportResult(result);
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
                <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 font-medium text-center">
                    Destination Period: {periodName}
                </div>
                <div className="w-full p-6 rounded-lg bg-green-50 border border-green-200">
                    <h3 className="text-lg font-semibold text-green-800 text-center">Evaluation Results Imported</h3>
                    <p className="text-sm text-green-700 text-center mt-1">
                        Evaluation results have been recorded into destination period &apos;{periodName}&apos;.
                    </p>
                    <ul className="mt-4 divide-y divide-green-200">
                        {importResult.perMetric.map((m) => (
                            <li key={m.metricId} className="flex items-center justify-between py-2 text-green-900">
                                <span>{m.name}</span>
                                <span className="font-mono font-medium">{m.count}</span>
                            </li>
                        ))}
                        <li className="flex items-center justify-between py-2 font-semibold text-green-900 border-t-2 border-green-300">
                            <span>Total</span>
                            <span className="font-mono">{importResult.totalCount}</span>
                        </li>
                    </ul>
                    {(importResult.created.length > 0 || importResult.attached.length > 0) && (
                        <p className="mt-3 text-sm text-green-800">
                            {importResult.created.length > 0 && (
                                <>
                                    Created {importResult.created.length}{" "}
                                    {importResult.created.length === 1 ? "metric" : "metrics"} (
                                    {importResult.created.map((m) => m.name).join(", ")}).{" "}
                                </>
                            )}
                            {importResult.attached.length > 0 && (
                                <>
                                    Added {importResult.attached.length} to this period (
                                    {importResult.attached.map((m) => m.name).join(", ")}).
                                </>
                            )}
                        </p>
                    )}
                </div>
                <button
                    onClick={handleReset}
                    className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                    Import More Results
                </button>
            </div>
        );
    }

    // Select step
    if (step === "select") {
        const canProceed = Boolean(autoDetectedPlayerColumn) && numericColumns.length > 0 && !noSelectableMetrics && mappedColumns.length > 0;

        return (
            <div className="w-full max-w-2xl flex flex-col gap-5">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 font-medium">
                    Destination Period: {periodName}
                </div>
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                    <p className="font-medium">Evaluation Results Import Scope</p>
                    <p className="mt-0.5 text-blue-800">
                        Importing results for destination period &apos;{periodName}&apos;. This matches existing roster members; unmatched names are skipped. During mapping, authorized users may attach an existing metric or create a new one. This workflow does not create roster members.
                    </p>
                </div>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Map Columns to Metrics</h3>
                    <button onClick={handleBack} className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
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
                        <p className="text-green-800 text-sm mt-1 ml-7">{rowCount} rows detected</p>
                    </div>
                ) : (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <p className="text-red-900 font-semibold">No player column found</p>
                        </div>
                        <p className="text-sm text-red-800 mt-2 ml-7">Please rename a column in your spreadsheet to one of these:</p>
                        <ul className="text-sm text-red-800 mt-1 ml-7 list-disc list-inside">
                            <li><strong>Player</strong> or <strong>Player Name</strong></li>
                            <li><strong>Member</strong> or <strong>Member Name</strong></li>
                            <li><strong>Name</strong>, <strong>IGN</strong>, or <strong>Alliance Member</strong></li>
                        </ul>
                    </div>
                )}

                {numericColumns.length === 0 && (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <p className="text-red-900 font-semibold">No numeric columns found</p>
                        <p className="text-sm text-red-800 mt-1">Your spreadsheet needs at least one column with whole numbers.</p>
                    </div>
                )}

                {noSelectableMetrics && (
                    <div className="p-4 rounded-md bg-red-100 border-2 border-red-400">
                        <p className="text-red-900 font-semibold">No metrics available</p>
                        <p className="text-sm text-red-800 mt-1">Ask an alliance admin to add metrics, then import again.</p>
                    </div>
                )}

                {/* Mapping table */}
                {autoDetectedPlayerColumn && numericColumns.length > 0 && !noSelectableMetrics && (
                    <>
                        <div className="p-4 bg-gray-50 rounded-md border border-gray-200">
                            <p className="text-sm font-semibold text-gray-900 mb-1">Choose which metric each column should import as</p>
                            <p className="text-sm text-gray-600 mb-3">
                                Columns are matched to metrics by name where possible.
                                {canCreateMetrics ? " Unrecognized columns default to \u201cDo not import\u201d - choose Create to add a new metric." : " Set any column you don\u2019t need to \u201cDo not import.\u201d"}
                            </p>
                            <div className="flex flex-col gap-3">
                                {columnMappings.map((mapping) => {
                                    const usedElsewhere = new Set(
                                        columnMappings
                                            .filter((m) => m.columnIndex !== mapping.columnIndex)
                                            .map((m) => (m.target.kind === "existing" || m.target.kind === "attach") ? m.target.metricId : null)
                                            .filter((id): id is string => id !== null),
                                    );
                                    return (
                                        <div key={mapping.columnIndex} className="flex items-center gap-3">
                                            <span className="w-2/5 truncate font-medium text-gray-900" title={mapping.columnName}>
                                                {mapping.columnName}
                                            </span>
                                            <span className="text-gray-400">→</span>
                                            <select
                                                aria-label={`Metric for ${mapping.columnName}`}
                                                value={targetToToken(mapping.target)}
                                                onChange={(e) => setColumnTarget(mapping.columnIndex, e.target.value, mapping.columnName)}
                                                className="flex-1 rounded-md border-2 border-gray-300 p-2 text-base text-gray-900 bg-white focus:border-blue-500"
                                            >
                                                <option value="">Do not import</option>
                                                {metrics.length > 0 && (
                                                    <optgroup label="On this period">
                                                        {metrics.map((metric) => (
                                                            <option key={metric.id} value={`existing:${metric.id}`} disabled={usedElsewhere.has(metric.id)}>
                                                                {metric.name}{usedElsewhere.has(metric.id) ? " (already mapped)" : ""}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                                {canAttachMetrics && libraryMetrics.length > 0 && (
                                                    <optgroup label="Add to this period">
                                                        {libraryMetrics.map((metric) => (
                                                            <option key={metric.id} value={`attach:${metric.id}`} disabled={usedElsewhere.has(metric.id)}>
                                                                {metric.name}{usedElsewhere.has(metric.id) ? " (already mapped)" : ""}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                                {canCreateMetrics && (
                                                    <option value="create">Create &ldquo;{mapping.columnName}&rdquo;</option>
                                                )}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {mappedColumns.length > 0 && (
                            <div className="p-4 rounded-md bg-blue-50 border border-blue-300">
                                <p className="text-blue-900 font-medium mb-1">
                                    Ready to import {mappedColumns.length} {mappedColumns.length === 1 ? "metric" : "metrics"}:
                                </p>
                                <ul className="text-blue-900 text-sm list-disc list-inside">
                                    <li>Player names from: <strong>{autoDetectedPlayerColumn.name}</strong></li>
                                    {mappedColumns.map((m) => {
                                        const disp = m.target.kind === "skip" ? "existing" : m.target.kind;
                                        return (
                                            <li key={m.columnIndex}>
                                                <strong>{m.columnName}</strong> → <strong>{displayNameFor(m.target, m.columnName)}</strong>
                                                {disp !== "existing" && (
                                                    <span className="ml-1 text-xs text-blue-700">({DISPOSITION_BADGE[disp].label})</span>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </>
                )}

                {error && (
                    <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">{error}</div>
                )}

                <div className="flex gap-3 justify-end">
                    <button onClick={handleBack} className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer">
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
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 font-medium">
                    Destination Period: {periodName}
                </div>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Review &amp; Confirm Import</h3>
                    <button onClick={handleBack} className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                        ← Back
                    </button>
                </div>

                {parseErrors.length > 0 && (
                    <div className="p-4 rounded-md bg-orange-100 border border-orange-300">
                        <h4 className="font-semibold text-orange-900 mb-2">Parse Warnings ({parseErrors.length})</h4>
                        <ul className="text-sm text-orange-800 list-disc list-inside max-h-24 overflow-y-auto">
                            {parseErrors.map((err, i) => (<li key={i}>{err}</li>))}
                        </ul>
                    </div>
                )}

                {previews.map((preview) => (
                    <MetricPreviewSection
                        key={preview.columnIndex}
                        preview={preview}
                        selections={duplicateSelections[preview.columnIndex]}
                        onDuplicateSelection={handleDuplicateSelection}
                    />
                ))}

                {error && (
                    <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">{error}</div>
                )}

                <div className="flex gap-3 justify-end">
                    <button onClick={handleBack} className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer">
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
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 font-medium flex items-center justify-between">
                <span>Destination Period: {periodName}</span>
                <TourButton tour={smartImportTour} />
            </div>
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                <p className="font-medium">Evaluation Results Import Scope</p>
                <p className="mt-0.5 text-blue-800">
                    Importing results for destination period &apos;{periodName}&apos;. This matches existing roster members; unmatched names are skipped. During mapping, authorized users may attach an existing metric or create a new one. This workflow does not create roster members.
                </p>
            </div>
            <div data-tour="metric-upload" className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50 hover:bg-blue-100 transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2">
                <input type="file" accept=".csv" onChange={handleFileUpload} className="sr-only" id="csv-upload" aria-label="Upload CSV spreadsheet (.csv)" />
                <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center gap-3">
                    <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-lg font-medium text-blue-900">Click to upload CSV spreadsheet (.csv)</span>
                    <span className="text-sm text-blue-700">Import several metrics from one spreadsheet</span>
                </label>
            </div>

            {error && (
                <div className="p-4 rounded-md bg-red-100 border border-red-300 text-red-900">{error}</div>
            )}

            <div data-tour="metric-requirements" className="p-4 rounded-md bg-gray-50 border border-gray-200">
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

// One reviewable section per mapped metric.
function MetricPreviewSection({
    preview,
    selections,
    onDuplicateSelection,
}: {
    preview: MetricImportPreview;
    selections: Record<string, number> | undefined;
    onDuplicateSelection: (columnIndex: number, memberId: string, resultIndex: number) => void;
}) {
    const { summary } = preview;

    const membersWithDuplicates = useMemo(() => {
        const counts = new Map<string, number>();
        for (const result of summary.results) {
            if (result.memberId) counts.set(result.memberId, (counts.get(result.memberId) || 0) + 1);
        }
        const duplicates = new Set<string>();
        for (const [memberId, count] of counts) {
            if (count > 1) duplicates.add(memberId);
        }
        return duplicates;
    }, [summary]);

    const willImportCount = getPreviewEntries(preview, selections).length;
    const hasDuplicates = summary.duplicates > 0;
    const badge = DISPOSITION_BADGE[preview.disposition];

    return (
        <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-gray-900">{preview.displayName}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs ${badge.className}`}>{badge.label}</span>
                </div>
                <span className="text-sm text-gray-600">from <strong>{preview.columnName}</strong></span>
            </div>

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
                            const memberHasDuplicates = result.memberId ? membersWithDuplicates.has(result.memberId) : false;
                            const isSelected = result.memberId ? selections?.[result.memberId] === i : false;
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
                                            <span className="px-2 py-0.5 rounded text-xs bg-red-200 text-red-800">No Match</span>
                                        ) : memberHasDuplicates ? (
                                            <button
                                                onClick={() => result.memberId && onDuplicateSelection(preview.columnIndex, result.memberId, i)}
                                                className={`px-2 py-1 rounded text-xs cursor-pointer ${isSelected ? "bg-green-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                                            >
                                                {isSelected ? "Selected" : "Use This"}
                                            </button>
                                        ) : willImport ? (
                                            <span className="px-2 py-0.5 rounded text-xs bg-green-200 text-green-800">Will Import</span>
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
