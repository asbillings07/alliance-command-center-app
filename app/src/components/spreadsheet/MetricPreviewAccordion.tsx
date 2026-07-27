"use client";

import { useMemo } from "react";
import { Badge } from "@/app/src/components/Badge";
import {
  getDefaultOpenMetricColumnIndex,
  getMetricPreviewCounts,
  type MetricImportPreviewData,
  type MetricDisposition,
} from "@/app/src/lib/import/importPreviewHelpers";

const DISPOSITION_BADGE: Record<MetricDisposition, { label: string; className: string }> = {
  existing: { label: "On period", className: "bg-surface border border-border text-text-secondary" },
  attach: { label: "Add to period", className: "bg-primary/20 border border-primary/40 text-primary-light font-medium" },
  create: { label: "New metric", className: "bg-primary/20 border border-primary/40 text-primary-light font-medium" },
};

type MetricPreviewAccordionProps = {
  previews: MetricImportPreviewData[];
  selectionsByColumn: Record<number, Record<string, number> | undefined>;
  onDuplicateSelection: (columnIndex: number, memberId: string, resultIndex: number) => void;
  contextLabelForPreview?: (preview: MetricImportPreviewData) => string | undefined;
};

export function MetricPreviewAccordion({
  previews,
  selectionsByColumn,
  onDuplicateSelection,
  contextLabelForPreview,
}: MetricPreviewAccordionProps) {
  const defaultOpenColumnIndex = useMemo(
    () => getDefaultOpenMetricColumnIndex(previews, selectionsByColumn),
    [previews, selectionsByColumn],
  );

  if (previews.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="region" aria-label="Metric import previews">
      {previews.map((preview) => (
        <MetricPreviewAccordionItem
          key={preview.columnIndex}
          preview={preview}
          selections={selectionsByColumn[preview.columnIndex]}
          onDuplicateSelection={onDuplicateSelection}
          defaultOpen={preview.columnIndex === defaultOpenColumnIndex}
          contextLabel={contextLabelForPreview?.(preview)}
        />
      ))}
    </div>
  );
}

function MetricPreviewAccordionItem({
  preview,
  selections,
  onDuplicateSelection,
  defaultOpen,
  contextLabel,
}: {
  preview: MetricImportPreviewData;
  selections: Record<string, number> | undefined;
  onDuplicateSelection: (columnIndex: number, memberId: string, resultIndex: number) => void;
  defaultOpen: boolean;
  contextLabel?: string;
}) {
  const { summary, skippedBlankCells } = preview;
  const counts = getMetricPreviewCounts(preview, selections);
  const badge = DISPOSITION_BADGE[preview.disposition];

  const membersWithDuplicates = useMemo(() => {
    const duplicateCounts = new Map<string, number>();
    for (const result of summary.results) {
      if (result.memberId) duplicateCounts.set(result.memberId, (duplicateCounts.get(result.memberId) || 0) + 1);
    }
    const duplicates = new Set<string>();
    for (const [memberId, count] of duplicateCounts) {
      if (count > 1) duplicates.add(memberId);
    }
    return duplicates;
  }, [summary]);

  const hasDuplicates = summary.duplicates > 0;
  const summaryId = `metric-preview-summary-${preview.columnIndex}`;
  const panelId = `metric-preview-panel-${preview.columnIndex}`;

  return (
    <details
      open={defaultOpen}
      className="border border-border bg-surface-secondary rounded-lg overflow-hidden group"
      data-testid={`metric-preview-${preview.columnIndex}`}
      data-metric-status={counts.status}
    >
      <summary
        id={summaryId}
        aria-controls={panelId}
        className="cursor-pointer list-none px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset select-none [&::-webkit-details-marker]:hidden"
      >
        <div className="flex items-start sm:items-center gap-2 min-w-0 flex-wrap">
          <span
            aria-hidden="true"
            className="text-text-muted transition-transform group-open:rotate-90 shrink-0 mt-0.5 sm:mt-0"
          >
            ▸
          </span>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-semibold text-text-primary">{preview.displayName}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${badge.className}`}>{badge.label}</span>
            <Badge variant={counts.status === "needs_review" ? "warning" : "success"} size="sm">
              {counts.status === "needs_review" ? "Needs review" : "Ready"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
          <Badge variant="success" size="sm">
            {counts.importableCount} importable
          </Badge>
          {counts.unmatchedCount > 0 && (
            <Badge variant="danger" size="sm">
              {counts.unmatchedCount} unmatched
            </Badge>
          )}
          {counts.invalidCount > 0 && (
            <Badge variant="danger" size="sm">
              {counts.invalidCount} invalid
            </Badge>
          )}
          {hasDuplicates && (
            <Badge variant="warning" size="sm">
              {summary.duplicates} duplicate{summary.duplicates === 1 ? "" : "s"}
            </Badge>
          )}
          <span className="text-text-muted hidden sm:inline">
            from <strong className="text-text-secondary">{preview.columnName}</strong>
            {contextLabel ? ` · ${contextLabel}` : ""}
          </span>
        </div>
      </summary>

      <div id={panelId} aria-labelledby={summaryId} className="px-4 pb-4 flex flex-col gap-3 border-t border-border/60">
        <p className="text-xs text-text-secondary pt-3">
          Proposed metric identity: <strong>{preview.proposedMetricName}</strong>
          <span className="sm:hidden text-text-muted">
            {" "}
            · from <strong>{preview.columnName}</strong>
            {contextLabel ? ` · ${contextLabel}` : ""}
          </span>
        </p>

        {hasDuplicates && (
          <div className="p-3 rounded-md bg-warning/10 border border-warning/30">
            <p className="text-sm text-warning">
              {summary.duplicates} duplicate {summary.duplicates === 1 ? "entry" : "entries"} detected.
              Click &quot;Use This&quot; to choose which value to import for each member.
            </p>
          </div>
        )}

        {skippedBlankCells.length > 0 && (
          <details className="text-sm text-text-secondary bg-surface border border-border rounded-md p-3">
            <summary className="cursor-pointer font-medium text-text-primary select-none">
              Review {skippedBlankCells.length} skipped blank cell{skippedBlankCells.length === 1 ? "" : "s"}
            </summary>
            <p className="text-xs text-text-muted mt-1">
              Blank cells will be skipped without creating entries or zeroes:
            </p>
            <ul className="text-xs font-mono space-y-1 mt-2 max-h-32 overflow-y-auto">
              {skippedBlankCells.map((cell, idx) => (
                <li key={idx} className="flex justify-between py-0.5 border-b border-border/40 last:border-0">
                  <span>{cell.rawName}</span>
                  <span className="text-text-muted">Cell {cell.address}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="border border-border rounded-md overflow-hidden bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary border-b border-border">
              <tr className="text-text-primary font-semibold">
                <th className="px-3 py-2 text-left">File Name</th>
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
                      result.status === "invalid_value" ? "bg-danger/20 text-danger font-semibold border-t border-border" :
                      result.status === "unmatched" ? "bg-danger/10 text-text-secondary border-t border-border" :
                      !isSelected ? "bg-surface-secondary text-text-disabled border-t border-border" :
                      "bg-success/10 text-text-primary border-t border-border"
                    }
                  >
                    <td className="px-3 py-2 font-medium">{result.rawName}</td>
                    <td className="px-3 py-2">
                      {result.matchedName || "—"}
                      {result.confidence > 0 && result.confidence < 1 && (
                        <span className={`ml-2 text-xs ${willImport ? "text-text-secondary" : "text-text-disabled"}`}>
                          ({Math.round(result.confidence * 100)}%)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">
                      {result.status === "invalid_value" ? (
                        <span className="text-danger font-bold">{result.rawValue} ({result.error})</span>
                      ) : (
                        result.value?.toLocaleString()
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {result.status === "invalid_value" ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-danger/20 text-danger font-bold">Invalid Value</span>
                      ) : result.status === "unmatched" ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-danger/10 text-danger">No Match</span>
                      ) : memberHasDuplicates ? (
                        <button
                          type="button"
                          onClick={() => result.memberId && onDuplicateSelection(preview.columnIndex, result.memberId, i)}
                          className={`px-2 py-1 rounded text-xs cursor-pointer ${isSelected ? "bg-success text-white" : "bg-surface-secondary border border-border text-text-secondary hover:bg-surface-elevated"}`}
                        >
                          {isSelected ? "Selected" : "Use This"}
                        </button>
                      ) : willImport ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-success/20 text-success font-medium">Will Import</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}