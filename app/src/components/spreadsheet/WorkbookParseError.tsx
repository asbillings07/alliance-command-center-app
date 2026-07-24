"use client";

import { SpreadsheetParseErrorCode } from "@/app/src/lib/workbookParser";

type WorkbookParseErrorProps = {
  code: SpreadsheetParseErrorCode;
  message: string;
  onDismiss?: () => void;
};

export function WorkbookParseError({
  code,
  message,
  onDismiss,
}: WorkbookParseErrorProps) {
  let title = "Workbook Import Error";
  let hint = "";

  switch (code) {
    case "file_too_large":
      title = "File Size Exceeds 5MB Limit";
      hint = "Please reduce file size or export a smaller subset of rows.";
      break;
    case "workbook_too_large":
      title = "Workbook Capacity Exceeded";
      hint = "Each worksheet is limited to 2,000 data rows and 100 columns. Please trim extra rows or sheets.";
      break;
    case "encrypted":
      title = "Encrypted or Password Protected File";
      hint = "Please open the file in Excel or Sheets, remove password protection, and save again.";
      break;
    case "no_worksheets":
      title = "No Visible Worksheets Found";
      hint = "The workbook contains no visible worksheets to import. Unhide at least one worksheet.";
      break;
    case "malformed":
      title = "Unable to Read Workbook";
      hint = "The file may be corrupt or in an unrecognized format. Try re-saving as .xlsx or .csv.";
      break;
    case "unsupported_format":
      title = "Unsupported Format";
      hint = "Supported formats are Excel (.xlsx, .xls) and CSV (.csv).";
      break;
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 my-4 space-y-2 text-xs text-destructive">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 font-semibold text-sm">
          <span>⚠️</span>
          <span>{title}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-destructive/70 hover:text-destructive p-1"
          >
            ✕
          </button>
        )}
      </div>
      <p className="leading-relaxed">{message}</p>
      {hint && <p className="font-medium text-destructive/90 text-[11px] pt-1">{hint}</p>}
    </div>
  );
}
