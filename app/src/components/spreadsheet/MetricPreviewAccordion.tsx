"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/app/src/components/Badge";
import {
  getDefaultActiveMetricIndex,
  getMetricIndicesNeedingReview,
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
  const [activeIndex, setActiveIndex] = useState(() =>
    getDefaultActiveMetricIndex(previews, selectionsByColumn),
  );
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  const reviewIndices = useMemo(
    () => getMetricIndicesNeedingReview(previews, selectionsByColumn),
    [previews, selectionsByColumn],
  );

  const navigableIndices = useMemo(
    () => (needsReviewOnly ? reviewIndices : previews.map((_, index) => index)),
    [needsReviewOnly, reviewIndices, previews],
  );

  const toggleNeedsReviewOnly = () => {
    setNeedsReviewOnly((current) => {
      const next = !current;
      if (next && reviewIndices.length > 0 && !reviewIndices.includes(activeIndex)) {
        setActiveIndex(reviewIndices[0]);
      }
      return next;
    });
  };

  if (previews.length === 0) return null;

  const safeActiveIndex = Math.min(activeIndex, previews.length - 1);
  const activePreview = previews[safeActiveIndex];
  const activeSelections = selectionsByColumn[activePreview.columnIndex];
  const contextLabel = contextLabelForPreview?.(activePreview);

  const positionInNavigable = navigableIndices.indexOf(safeActiveIndex);
  const canGoPrevious = positionInNavigable > 0;
  const canGoNext = positionInNavigable >= 0 && positionInNavigable < navigableIndices.length - 1;

  const goToIndex = (index: number) => {
    if (index >= 0 && index < previews.length) setActiveIndex(index);
  };

  const goPrevious = () => {
    if (canGoPrevious) setActiveIndex(navigableIndices[positionInNavigable - 1]);
  };

  const goNext = () => {
    if (canGoNext) setActiveIndex(navigableIndices[positionInNavigable + 1]);
  };

  const positionLabel = needsReviewOnly && reviewIndices.length > 0
    ? `Needs review ${positionInNavigable + 1} of ${navigableIndices.length}`
    : `Metric ${safeActiveIndex + 1} of ${previews.length}`;

  const headerContext = contextLabel ? `Period: ${contextLabel} — ${positionLabel}` : positionLabel;

  return (
    <div className="flex flex-col gap-3" role="region" aria-label="Metric import previews">
      <div
        className="flex flex-col gap-3 p-3 border border-border bg-surface-secondary rounded-lg"
        data-testid="metric-preview-navigator"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-text-primary" id="metric-preview-position">
            {headerContext}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {reviewIndices.length > 0 && (
              <button
                type="button"
                data-testid="metric-preview-needs-review-filter"
                aria-pressed={needsReviewOnly}
                aria-label={
                  needsReviewOnly
                    ? `Showing only metrics needing review (${reviewIndices.length}). Click to show all metrics.`
                    : `${reviewIndices.length} metrics need review. Click to filter navigation to those metrics only.`
                }
                onClick={toggleNeedsReviewOnly}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  needsReviewOnly
                    ? "bg-warning/20 border-warning/40 text-warning"
                    : "bg-surface border-border text-text-secondary hover:bg-surface-elevated"
                }`}
              >
                <Badge variant="warning" size="sm">
                  {reviewIndices.length} need review
                </Badge>
                {needsReviewOnly ? "Showing review only" : "Filter to review"}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="metric-preview-previous"
              aria-label="Previous metric"
              disabled={!canGoPrevious}
              onClick={goPrevious}
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-sm text-text-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Previous
            </button>
            <button
              type="button"
              data-testid="metric-preview-next"
              aria-label="Next metric"
              disabled={!canGoNext}
              onClick={goNext}
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-sm text-text-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Next
            </button>
          </div>

          <div className="flex flex-col gap-1 sm:flex-1 sm:max-w-md">
            <label htmlFor="metric-preview-jump" className="text-xs font-medium text-text-secondary">
              Jump to metric
            </label>
            <select
              id="metric-preview-jump"
              data-testid="metric-preview-jump"
              aria-labelledby="metric-preview-position metric-preview-jump"
              value={String(safeActiveIndex)}
              onChange={(event) => goToIndex(Number(event.target.value))}
              className="w-full px-3 py-1.5 rounded-md border border-border bg-surface text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {(needsReviewOnly ? reviewIndices : previews.map((_, index) => index)).map((index) => {
                const preview = previews[index];
                const counts = getMetricPreviewCounts(preview, selectionsByColumn[preview.columnIndex]);
                const periodSuffix = contextLabelForPreview?.(preview)
                  ? ` (${contextLabelForPreview(preview)})`
                  : "";
                return (
                  <option key={preview.columnIndex} value={String(index)}>
                    {preview.displayName}
                    {periodSuffix}
                    {counts.status === "needs_review" ? " — Needs review" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <MetricPreviewDetail
        key={activePreview.columnIndex}
        preview={activePreview}
        selections={activeSelections}
        onDuplicateSelection={onDuplicateSelection}
        contextLabel={contextLabel}
      />
    </div>
  );
}

function MetricPreviewDetail({
  preview,
  selections,
  onDuplicateSelection,
  contextLabel,
}: {
  preview: MetricImportPreviewData;
  selections: Record<string, number> | undefined;
  onDuplicateSelection: (columnIndex: number, memberId: string, resultIndex: number) => void;
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
  const headerId = `metric-preview-header-${preview.columnIndex}`;

  return (
    <section
      aria-labelledby={headerId}
      className="border border-border bg-surface-secondary rounded-lg overflow-hidden"
      data-testid={`metric-preview-${preview.columnIndex}`}
      data-metric-status={counts.status}
    >
      <div
        id={headerId}
        className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-semibold text-text-primary">{preview.displayName}</span>
          <span className={`px-2 py-0.5 rounded text-xs ${badge.className}`}>{badge.label}</span>
          <Badge variant={counts.status === "needs_review" ? "warning" : "success"} size="sm">
            {counts.status === "needs_review" ? "Needs review" : "Ready"}
          </Badge>
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
      </div>

      <div className="px-4 pb-4 flex flex-col gap-3">
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

        <div
          className="border border-border rounded-md overflow-hidden bg-surface"
          data-testid="metric-preview-row-detail"
        >
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
                    data-testid={`metric-preview-row-${preview.columnIndex}-${i}`}
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
    </section>
  );
}
