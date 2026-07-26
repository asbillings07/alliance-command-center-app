import { useMemo } from "react";
import {
  getPreviewEntries,
  type MetricImportPreviewData,
  type MetricDisposition,
} from "@/app/src/lib/import/importPreviewHelpers";

const DISPOSITION_BADGE: Record<MetricDisposition, { label: string; className: string }> = {
  existing: { label: "On period", className: "bg-surface border border-border text-text-secondary" },
  attach: { label: "Add to period", className: "bg-primary/20 border border-primary/40 text-primary-light font-medium" },
  create: { label: "New metric", className: "bg-primary/20 border border-primary/40 text-primary-light font-medium" },
};

export function MetricPreviewSection({
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
    <div className="border border-border bg-surface-secondary rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-semibold text-text-primary">{preview.displayName}</h4>
          <span className={`px-2 py-0.5 rounded text-xs ${badge.className}`}>{badge.label}</span>
        </div>
        <span className="text-sm text-text-muted">
          from <strong>{preview.columnName}</strong>
          {contextLabel ? ` · ${contextLabel}` : ""}
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        Proposed metric identity: <strong>{preview.proposedMetricName}</strong>
      </p>

      <div className="grid grid-cols-4 gap-3 text-center">
        <div className="p-3 rounded-md bg-surface border border-border">
          <div className="text-xl font-bold text-text-primary">{summary.total}</div>
          <div className="text-xs text-text-secondary">Valid Data Rows</div>
        </div>
        <div className="p-3 rounded-md bg-success/10 border border-success/30">
          <div className="text-xl font-bold text-success">{willImportCount}</div>
          <div className="text-xs text-text-secondary">Will Import</div>
        </div>
        <div className="p-3 rounded-md bg-surface border border-border">
          <div className="text-xl font-bold text-text-muted">{skippedBlankCells.length}</div>
          <div className="text-xs text-text-secondary">Skipped Blanks</div>
        </div>
        <div className="p-3 rounded-md bg-danger/10 border border-danger/30">
          <div className="text-xl font-bold text-danger">{summary.unmatched}</div>
          <div className="text-xs text-text-secondary">Unmatched</div>
        </div>
      </div>

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

      {hasDuplicates && (
        <div className="p-3 rounded-md bg-warning/10 border border-warning/30">
          <p className="text-sm text-warning">
            {summary.duplicates} duplicate {summary.duplicates === 1 ? "entry" : "entries"} detected.
            Click &quot;Use This&quot; to choose which value to import for each member.
          </p>
        </div>
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
  );
}
