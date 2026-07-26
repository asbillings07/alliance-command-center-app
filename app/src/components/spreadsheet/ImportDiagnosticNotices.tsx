import type { WorkbookIssue } from "@/app/src/lib/workbookParser";

type ColumnValueIssue = {
  columnName: string;
  error: string;
};

function formatCellCount(count: number): string {
  return `${count} spreadsheet ${count === 1 ? "cell" : "cells"}`;
}

function summarizeColumns(columnNames: string[]): string {
  const uniqueColumns = [...new Set(columnNames)];
  const visibleColumns = uniqueColumns.slice(0, 3).join(", ");
  const remainingCount = uniqueColumns.length - 3;
  const suffix = remainingCount > 0 ? `, +${remainingCount} more` : "";
  return `${uniqueColumns.length === 1 ? "Column" : "Columns"}: ${visibleColumns}${suffix}`;
}

export function WorkbookIssueNotice({
  issues,
  tone,
  columnNameForIssue,
}: {
  issues: WorkbookIssue[];
  tone: "blocking" | "warning";
  columnNameForIssue: (columnIndex: number) => string;
}) {
  if (issues.length === 0) return null;

  const isBlocking = tone === "blocking";
  const containerClass = isBlocking
    ? "bg-danger/10 border-danger/30 text-danger"
    : "bg-warning/10 border-warning/30 text-warning";
  const secondaryText = isBlocking ? "text-text-secondary" : "text-text-secondary";

  return (
    <div className={`p-4 rounded-md border flex flex-col gap-2 ${containerClass}`}>
      <div>
        <p className="font-semibold">
          {isBlocking ? "Fix spreadsheet errors before importing" : "Spreadsheet warnings detected"}
        </p>
        <p className={`text-sm mt-1 ${secondaryText}`}>
          {summarizeColumns(issues.map((issue) => columnNameForIssue(issue.columnIndex)))}
        </p>
      </div>
      <details className={`text-sm ${secondaryText}`}>
        <summary className="cursor-pointer font-medium">View cell details</summary>
        <ul className="list-disc list-inside text-xs mt-2 max-h-32 overflow-y-auto space-y-0.5">
          {issues.map((issue, idx) => (
            <li key={idx}>
              <strong>{columnNameForIssue(issue.columnIndex)}</strong>
              {issue.address ? ` (${issue.address})` : ""}: {issue.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function ValueIssueNotice({
  issues,
  phase,
}: {
  issues: ColumnValueIssue[];
  phase: "preview" | "import";
}) {
  if (issues.length === 0) return null;

  return (
    <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger flex flex-col gap-2">
      <div>
        <p className="font-semibold text-danger">
          Fix {formatCellCount(issues.length)} before {phase === "preview" ? "previewing" : "importing"}
        </p>
        <p className="text-sm text-text-secondary mt-1">
          {summarizeColumns(issues.map((issue) => issue.columnName))}. Check cell details below.
        </p>
      </div>
      <details className="text-sm text-text-secondary">
        <summary className="cursor-pointer font-medium text-text-primary select-none">View cell details</summary>
        <ul className="text-xs list-disc list-inside mt-2 max-h-32 overflow-y-auto space-y-0.5 font-mono">
          {issues.map((issue, i) => (
            <li key={i}>
              <strong>{issue.columnName}</strong>: {issue.error}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
