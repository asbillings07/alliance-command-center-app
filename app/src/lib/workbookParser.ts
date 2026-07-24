export type WorkbookIssueCode =
  | "formula_cached_value"
  | "formula_missing_cached_value"
  | "cell_error";

export type WorkbookIssueSeverity = "warning" | "blocking";

export type WorkbookIssue = {
  sheetIndex: number;
  sheetName: string;
  rowIndex: number;
  columnIndex: number;
  address: string;
  code: WorkbookIssueCode;
  severity: WorkbookIssueSeverity;
  message: string;
  formula?: string;
  displayText?: string;
};

export type SheetVisibility = "visible" | "hidden" | "very_hidden";

export type WorkbookSheet = {
  index: number;
  name: string;
  rows: string[][];
  issues: WorkbookIssue[];
  visibility: SheetVisibility;
};

export type ParsedWorkbook = {
  fileName: string;
  format: "xlsx" | "xls" | "csv" | "numbers";
  sheets: WorkbookSheet[];
  defaultSheetIndex: number;
};

export type SpreadsheetParseErrorCode =
  | "unsupported_format"
  | "encrypted"
  | "malformed"
  | "file_too_large"
  | "workbook_too_large"
  | "no_worksheets";

export type SpreadsheetParseResult =
  | { kind: "workbook"; workbook: ParsedWorkbook }
  | { kind: "numbers_export_required" }
  | {
      kind: "error";
      code: SpreadsheetParseErrorCode;
      message: string;
    };

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_WORKSHEETS = 20;
export const MAX_DATA_ROWS_PER_SHEET = 2000;
export const MAX_PHYSICAL_ROWS_PER_SHEET = 2001; // 1 header row + 2000 data rows
export const SHEET_ROWS_READ_LIMIT = 2002; // Read 1 beyond physical ceiling to detect overflow
export const MAX_TOTAL_WORKBOOK_ROWS = 10000;
export const MAX_COLUMNS_PER_SHEET = 100;
export const MAX_TOTAL_MATERIALIZED_CELLS = 100000;

function isNumbersFile(fileName: string, bytes: Uint8Array): boolean {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".numbers")) {
    return true;
  }

  // Check ZIP signature (PK\x03\x04)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    // Check for Apple Numbers specific signatures in ZIP entries
    const byteString = Array.from(bytes.slice(0, Math.min(bytes.length, 4096)))
      .map((b) => String.fromCharCode(b))
      .join("");

    if (
      byteString.includes("Index/Document.iwa") ||
      byteString.includes("buildVersionHistory.plist") ||
      byteString.includes("QuickLook/Thumbnail.jpg")
    ) {
      return true;
    }
  }

  return false;
}

function hasBinaryGarbage(str: string): boolean {
  // Checks for non-printable control characters typical of raw binary files (excluding \t, \n, \r)
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(str);
}

export async function parseWorkbookBytes(
  bytes: Uint8Array,
  metadata: { fileName: string; fileSize: number }
): Promise<SpreadsheetParseResult> {
  const { fileName, fileSize } = metadata;

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    return {
      kind: "error",
      code: "file_too_large",
      message: `File size (${(fileSize / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum limit of 5.0 MB.`,
    };
  }

  if (isNumbersFile(fileName, bytes)) {
    return { kind: "numbers_export_required" };
  }

  const lowerName = fileName.toLowerCase();
  const supportedExtensions = [".csv", ".xlsx", ".xls", ".numbers"];
  const hasSupportedExtension = supportedExtensions.some((ext) => lowerName.endsWith(ext));

  if (!hasSupportedExtension) {
    return {
      kind: "error",
      code: "unsupported_format",
      message: "Unsupported file format. Supported spreadsheet formats are .xlsx, .xls, .csv, and .numbers.",
    };
  }

  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    return {
      kind: "error",
      code: "malformed",
      message: "Failed to load spreadsheet parser library.",
    };
  }

  let workbook: import("xlsx").WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      raw: true,
      cellText: true,
      cellFormula: true,
      cellDates: false,
      dense: true,
      sheetRows: SHEET_ROWS_READ_LIMIT,
    });
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (/password|encrypted|protected/i.test(errMessage)) {
      return {
        kind: "error",
        code: "encrypted",
        message: "The workbook is password protected or encrypted. Please remove password protection before importing.",
      };
    }
    return {
      kind: "error",
      code: "malformed",
      message: "Unable to parse file. The file may be corrupt, malformed, or in an unsupported format.",
    };
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      kind: "error",
      code: "no_worksheets",
      message: "Workbook contains no worksheets.",
    };
  }

  if (workbook.SheetNames.length > MAX_WORKSHEETS) {
    return {
      kind: "error",
      code: "workbook_too_large",
      message: `Workbook contains ${workbook.SheetNames.length} worksheets, which exceeds the limit of ${MAX_WORKSHEETS}.`,
    };
  }

  const sheets: WorkbookSheet[] = [];
  let totalWorkbookRows = 0;
  let totalMaterializedCells = 0;
  let detectedBinaryGarbage = false;

  for (let sIdx = 0; sIdx < workbook.SheetNames.length; sIdx++) {
    const sheetName = workbook.SheetNames[sIdx];
    const sheet = workbook.Sheets[sheetName];

    // Determine visibility
    let visibility: SheetVisibility = "visible";
    if (workbook.Workbook?.Sheets?.[sIdx]) {
      const sheetMeta = workbook.Workbook.Sheets[sIdx];
      if (sheetMeta.Hidden === 1) {
        visibility = "hidden";
      } else if (sheetMeta.Hidden === 2) {
        visibility = "very_hidden";
      }
    }

    if (!sheet) {
      sheets.push({
        index: sIdx,
        name: sheetName,
        rows: [],
        issues: [],
        visibility,
      });
      continue;
    }

    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    const numRows = range.e.r - range.s.r + 1;
    const numCols = range.e.c - range.s.c + 1;

    if (numCols > MAX_COLUMNS_PER_SHEET) {
      return {
        kind: "error",
        code: "workbook_too_large",
        message: `Worksheet "${sheetName}" has ${numCols} columns, exceeding the maximum limit of ${MAX_COLUMNS_PER_SHEET} columns.`,
      };
    }

    // Check physical row limit (max 2001 rows: 1 header + 2000 data rows)
    if (numRows > MAX_PHYSICAL_ROWS_PER_SHEET) {
      return {
        kind: "error",
        code: "workbook_too_large",
        message: `Worksheet "${sheetName}" contains more than ${MAX_DATA_ROWS_PER_SHEET} data rows. Please trim the dataset before importing.`,
      };
    }

    totalWorkbookRows += numRows;
    if (totalWorkbookRows > MAX_TOTAL_WORKBOOK_ROWS) {
      return {
        kind: "error",
        code: "workbook_too_large",
        message: `Total rows across all worksheets (${totalWorkbookRows}) exceeds the maximum limit of ${MAX_TOTAL_WORKBOOK_ROWS}.`,
      };
    }

    const sheetRows: string[][] = [];
    const sheetIssues: WorkbookIssue[] = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const rowData: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        totalMaterializedCells++;
        if (totalMaterializedCells > MAX_TOTAL_MATERIALIZED_CELLS) {
          return {
            kind: "error",
            code: "workbook_too_large",
            message: `Workbook cell count exceeds the maximum limit of ${MAX_TOTAL_MATERIALIZED_CELLS} materialized cells.`,
          };
        }

        const address = XLSX.utils.encode_cell({ r, c });
        // Dense or sparse cell lookup
        const cell = sheet["!data"]?.[r]?.[c] || sheet[address];

        if (!cell) {
          rowData.push("");
          continue;
        }

        const rawVal = cell.v;
        const formattedText = cell.w !== undefined ? String(cell.w) : rawVal !== undefined && rawVal !== null ? String(rawVal) : "";

        if (hasBinaryGarbage(formattedText)) {
          detectedBinaryGarbage = true;
        }

        // Formula cells handling
        if (cell.f) {
          const isMissingCachedVal =
            rawVal === undefined ||
            rawVal === null ||
            (cell.t === "e" && (rawVal === "#N/A" || rawVal === 0x2a || rawVal === 42 || rawVal === ""));

          if (isMissingCachedVal) {
            rowData.push("");
            sheetIssues.push({
              sheetIndex: sIdx,
              sheetName,
              rowIndex: r - range.s.r,
              columnIndex: c - range.s.c,
              address,
              code: "formula_missing_cached_value",
              severity: "blocking",
              message: `Cell ${address} contains a formula (= ${cell.f}) with no cached result. Please re-save the workbook in your spreadsheet software to generate cached values before importing.`,
              formula: cell.f,
            });
            continue;
          } else if (
            cell.t === "e" ||
            (typeof rawVal === "string" && /^#(REF|VALUE|NAME\?|DIV\/0!|NULL!|NUM!|GETTING_DATA)!?/i.test(rawVal))
          ) {
            const displayErr = formattedText || String(rawVal || "#ERROR!");
            rowData.push(displayErr);
            sheetIssues.push({
              sheetIndex: sIdx,
              sheetName,
              rowIndex: r - range.s.r,
              columnIndex: c - range.s.c,
              address,
              code: "cell_error",
              severity: "blocking",
              message: `Cell ${address} contains formula (= ${cell.f}) evaluating to error ${displayErr}.`,
              displayText: displayErr,
              formula: cell.f,
            });
            continue;
          } else {
            rowData.push(formattedText);
            sheetIssues.push({
              sheetIndex: sIdx,
              sheetName,
              rowIndex: r - range.s.r,
              columnIndex: c - range.s.c,
              address,
              code: "formula_cached_value",
              severity: "warning",
              message: `Cell ${address} contains a formula (= ${cell.f}). Importing calculated result "${formattedText}".`,
              formula: cell.f,
              displayText: formattedText,
            });
            continue;
          }
        }

        // Non-formula cell check: cell_error
        if (cell.t === "e" || (typeof rawVal === "string" && /^#(REF|VALUE|N\/A|NAME\?|DIV\/0!|NULL!|NUM!|GETTING_DATA)!?/i.test(rawVal))) {
          const displayErr = formattedText || (typeof rawVal === "string" ? rawVal : "#ERROR!");
          rowData.push(displayErr);
          sheetIssues.push({
            sheetIndex: sIdx,
            sheetName,
            rowIndex: r - range.s.r,
            columnIndex: c - range.s.c,
            address,
            code: "cell_error",
            severity: "blocking",
            message: `Cell ${address} contains error value ${displayErr}.`,
            displayText: displayErr,
          });
          continue;
        }

        rowData.push(formattedText);
      }
      sheetRows.push(rowData);
    }

    sheets.push({
      index: sIdx,
      name: sheetName,
      rows: sheetRows,
      issues: sheetIssues,
      visibility,
    });
  }

  if (detectedBinaryGarbage) {
    return {
      kind: "error",
      code: "malformed",
      message: "Unable to parse file. The file appears to contain invalid or binary non-text content.",
    };
  }

  // Determine default visible sheet index
  const defaultSheetIndex = sheets.findIndex((s) => s.visibility === "visible");
  if (defaultSheetIndex === -1) {
    return {
      kind: "error",
      code: "no_worksheets",
      message: "Workbook contains no visible worksheets to import.",
    };
  }

  let format: "xlsx" | "xls" | "csv" | "numbers" = "xlsx";
  if (lowerName.endsWith(".csv")) {
    format = "csv";
  } else if (lowerName.endsWith(".xls")) {
    format = "xls";
  }

  return {
    kind: "workbook",
    workbook: {
      fileName,
      format,
      sheets,
      defaultSheetIndex,
    },
  };
}

function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(new TextEncoder().encode(result));
      } else if (result && typeof (result as ArrayBuffer).byteLength === "number") {
        resolve(new Uint8Array(result as ArrayBuffer));
      } else {
        reject(new Error("Failed to read blob"));
      }
    };
    reader.onerror = () => reject(reader.error);
    if (typeof reader.readAsArrayBuffer === "function") {
      reader.readAsArrayBuffer(blob);
    } else if (typeof reader.readAsText === "function") {
      reader.readAsText(blob);
    } else {
      reject(new Error("FileReader methods not available"));
    }
  });
}

export async function parseWorkbookFile(file: File): Promise<SpreadsheetParseResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      kind: "error",
      code: "file_too_large",
      message: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum limit of 5.0 MB.`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBlobAsUint8Array(file);
  } catch {
    if (typeof file.arrayBuffer === "function") {
      const buffer = await file.arrayBuffer();
      bytes = new Uint8Array(buffer);
    } else {
      return {
        kind: "error",
        code: "malformed",
        message: "Unable to read file content.",
      };
    }
  }

  return parseWorkbookBytes(bytes, {
    fileName: file.name,
    fileSize: file.size,
  });
}
