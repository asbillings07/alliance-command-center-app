"use client";

import { WorkbookSheet } from "@/app/src/lib/workbookParser";

type WorkbookSheetSelectorProps = {
  sheets: WorkbookSheet[];
  selectedSheetIndex: number;
  onSelectSheet: (index: number) => void;
  disabled?: boolean;
};

export function WorkbookSheetSelector({
  sheets,
  selectedSheetIndex,
  onSelectSheet,
  disabled = false,
}: WorkbookSheetSelectorProps) {
  const visibleSheets = sheets.filter((s) => s.visibility === "visible");

  if (visibleSheets.length <= 1) {
    return null;
  }

  return (
    <div className="flex flex-col space-y-2 my-4">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Worksheet Selection ({visibleSheets.length} Worksheets)
      </label>
      <div className="flex flex-wrap gap-2">
        {visibleSheets.map((sheet) => {
          const isSelected = sheet.index === selectedSheetIndex;
          const dataRowCount = Math.max(0, sheet.rows.length - 1);

          return (
            <button
              key={sheet.index}
              type="button"
              disabled={disabled}
              onClick={() => onSelectSheet(sheet.index)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex items-center space-x-2 ${
                isSelected
                  ? "bg-accent text-accent-foreground border-accent shadow-sm"
                  : "bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span>{sheet.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  isSelected
                    ? "bg-accent-foreground/10 text-accent-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {dataRowCount} {dataRowCount === 1 ? "row" : "rows"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
