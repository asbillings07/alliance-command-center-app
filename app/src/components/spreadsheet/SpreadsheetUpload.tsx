"use client";

import { useState, useRef, ReactNode } from "react";

type SpreadsheetUploadProps = {
  id?: string;
  ariaLabel?: string;
  onFileSelected: (file: File) => void;
  isLoading?: boolean;
  disabled?: boolean;
  children?: ReactNode;
};

export function SpreadsheetUpload({
  id,
  ariaLabel,
  onFileSelected,
  isLoading = false,
  disabled = false,
  children,
}: SpreadsheetUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isLoading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled || isLoading) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      onFileSelected(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      onFileSelected(file);
      e.target.value = "";
    }
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        id={id}
        aria-label={ariaLabel}
        type="file"
        accept=".csv,.xlsx,.xls,.numbers"
        className="sr-only"
        onChange={handleFileChange}
        disabled={disabled || isLoading}
      />
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled && !isLoading && fileInputRef.current) {
            fileInputRef.current.click();
          }
        }}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-accent bg-accent/5"
            : disabled || isLoading
            ? "border-border/50 bg-card/50 cursor-not-allowed opacity-60"
            : "border-border hover:border-accent/50 bg-card hover:bg-card/80"
        }`}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center space-y-2 py-4">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">Reading workbook data...</p>
          </div>
        ) : children ? (
          children
        ) : (
          <div className="flex flex-col items-center justify-center space-y-2 py-4">
            <svg
              className="w-10 h-10 text-muted-foreground mb-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-sm font-semibold text-foreground">
              Drop your spreadsheet here, or <span className="text-accent underline">browse</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Supports Excel (.xlsx, .xls), CSV (.csv), or Apple Numbers (.numbers)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
