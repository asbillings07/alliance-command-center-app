"use client";

import type { ReactNode } from "react";
import { ImportFileUpload } from "../ImportFileUpload";

type SpreadsheetUploadProps = {
  id?: string;
  ariaLabel?: string;
  buttonLabel?: string;
  onFileSelected: (file: File) => void;
  isLoading?: boolean;
  disabled?: boolean;
  children?: ReactNode;
};

export function SpreadsheetUpload({
  id,
  ariaLabel,
  buttonLabel,
  onFileSelected,
  isLoading = false,
  disabled = false,
  children,
}: SpreadsheetUploadProps) {
  return (
    <ImportFileUpload id={id} ariaLabel={ariaLabel} buttonLabel={buttonLabel ?? "Select Spreadsheet File"}
      accept=".csv,.xlsx,.xls,.numbers" dropSubject="your spreadsheet"
      fileDescription="Supports Excel (.xlsx, .xls), CSV (.csv), or Apple Numbers (.numbers)"
      loadingText="Reading workbook data..." isLoading={isLoading} disabled={disabled}
      onFilesSelected={files => onFileSelected(files[0])}>
      {children}
    </ImportFileUpload>
  );
}
