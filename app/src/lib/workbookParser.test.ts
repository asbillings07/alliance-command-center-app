import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  parseWorkbookBytes,
  parseWorkbookFile,
  MAX_DATA_ROWS_PER_SHEET,
} from "./workbookParser";

function createXlsxBuffer(
  sheetsData: Array<{ name: string; data: (string | number | boolean | null)[][]; hidden?: boolean; veryHidden?: boolean }>,
  customizer?: (ws: XLSX.WorkSheet) => void
): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheetsData) {
    const ws = XLSX.utils.aoa_to_sheet(s.data);
    if (customizer) {
      customizer(ws);
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name);
    if (s.hidden || s.veryHidden) {
      const idx = wb.SheetNames.indexOf(s.name);
      if (!wb.Workbook) wb.Workbook = { Sheets: [] };
      if (!wb.Workbook.Sheets) wb.Workbook.Sheets = [];
      wb.Workbook.Sheets[idx] = { Hidden: s.veryHidden ? 2 : 1 };
    }
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Uint8Array(buf);
}

function createXlsBuffer(
  sheetName: string,
  data: (string | number | boolean | null)[][]
): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: "xls", type: "array" });
  return new Uint8Array(buf);
}

describe("workbookParser", () => {
  describe("CSV parsing", () => {
    it("parses basic CSV string and preserves leading zeroes", async () => {
      const csvContent = "Player,THP,ZipCode\nAlice,01234,007";
      const bytes = new TextEncoder().encode(csvContent);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "roster.csv",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.format).toBe("csv");
        expect(result.workbook.sheets).toHaveLength(1);
        expect(result.workbook.sheets[0].rows).toEqual([
          ["Player", "THP", "ZipCode"],
          ["Alice", "01234", "007"],
        ]);
        expect(result.workbook.sheets[0].issues).toHaveLength(0);
      }
    });

    it("handles UTF-8 BOM, CRLF, and quoted multiline strings in CSV", async () => {
      const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
      const csvContent = 'Player,Notes,Role\r\nBob,"Line 1\r\nLine 2",Officer';
      const textBytes = new TextEncoder().encode(csvContent);
      const combined = new Uint8Array(bom.length + textBytes.length);
      combined.set(bom, 0);
      combined.set(textBytes, bom.length);

      const result = await parseWorkbookBytes(combined, {
        fileName: "roster_bom.csv",
        fileSize: combined.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets[0].rows).toEqual([
          ["Player", "Notes", "Role"],
          ["Bob", "Line 1\r\nLine 2", "Officer"],
        ]);
      }
    });
  });

  describe("XLSX & XLS binary parsing", () => {
    it("parses standard XLSX workbook", async () => {
      const bytes = createXlsxBuffer([
        {
          name: "Roster",
          data: [
            ["Player", "THP"],
            ["Charlie", 123456],
          ],
        },
      ]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "alliance_roster.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.format).toBe("xlsx");
        expect(result.workbook.sheets[0].rows).toEqual([
          ["Player", "THP"],
          ["Charlie", "123456"],
        ]);
      }
    });

    it("parses XLS legacy format", async () => {
      const bytes = createXlsBuffer("Members", [
        ["Name", "Rank"],
        ["Dave", 1],
      ]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "legacy.xls",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.format).toBe("xls");
        expect(result.workbook.sheets[0].rows).toEqual([
          ["Name", "Rank"],
          ["Dave", "1"],
        ]);
      }
    });
  });

  describe("Multi-sheet and visibility policy", () => {
    it("defaults to first visible sheet when first sheet is hidden", async () => {
      const bytes = createXlsxBuffer([
        { name: "HiddenMeta", data: [["Key", "Value"]], hidden: true },
        { name: "MainData", data: [["Player", "THP"], ["Eve", "999"]] },
      ]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "multisheet.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets).toHaveLength(2);
        expect(result.workbook.sheets[0].visibility).toBe("hidden");
        expect(result.workbook.sheets[1].visibility).toBe("visible");
        expect(result.workbook.defaultSheetIndex).toBe(1);
      }
    });

    it("returns no_worksheets error when all sheets are hidden", async () => {
      const bytes = createXlsxBuffer([
        { name: "Hidden1", data: [["A", "B"]], hidden: true },
        { name: "Hidden2", data: [["C", "D"]], veryHidden: true },
      ]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "all_hidden.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("no_worksheets");
        expect(result.message).toMatch(/no visible worksheets/i);
      }
    });
  });

  describe("Formulas & Error cells", () => {
    it("records formula_cached_value warning for formulas with cached results", async () => {
      const bytes = createXlsxBuffer(
        [{ name: "Sheet1", data: [["Score", "Bonus", "Total"], [10, 20, 30]] }],
        (ws) => {
          ws["C2"] = { f: "A2+B2", v: 30, w: "30", t: "n" };
        }
      );

      const result = await parseWorkbookBytes(bytes, {
        fileName: "formulas.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        const issues = result.workbook.sheets[0].issues;
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe("formula_cached_value");
        expect(issues[0].severity).toBe("warning");
        expect(issues[0].displayText).toBe("30");
        expect(result.workbook.sheets[0].rows[1][2]).toBe("30");
      }
    });

    it("records formula_missing_cached_value blocking error when formula lacks cached value", async () => {
      const bytes = createXlsxBuffer(
        [{ name: "Sheet1", data: [["Val1", "Val2", "Result"], [5, 10, null]] }],
        (ws) => {
          ws["C2"] = { f: "A2+B2", t: "n" }; // Has formula, no v or w
        }
      );

      // Strip <v>15</v> from uncompressed ZIP XML stream in bytes
      const str = Array.from(bytes).map((b) => String.fromCharCode(b)).join("");
      const strippedStr = str.replace("<v>15</v>", "");
      const strippedBytes = new Uint8Array(strippedStr.length);
      for (let i = 0; i < strippedStr.length; i++) {
        strippedBytes[i] = strippedStr.charCodeAt(i) & 0xff;
      }

      const result = await parseWorkbookBytes(strippedBytes, {
        fileName: "uncached_formula.xlsx",
        fileSize: strippedBytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        const issues = result.workbook.sheets[0].issues;
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe("formula_missing_cached_value");
        expect(issues[0].severity).toBe("blocking");
      }
    });

    it("records cell_error blocking issue and preserves visible error token", async () => {
      const bytes = createXlsxBuffer(
        [{ name: "Sheet1", data: [["Player", "THP"], ["Frank", 100]] }],
        (ws) => {
          ws["B2"] = { t: "e", v: 0x17, w: "#REF!" };
        }
      );

      const result = await parseWorkbookBytes(bytes, {
        fileName: "error_cells.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets[0].rows[1][1]).toBe("#REF!");
        const issues = result.workbook.sheets[0].issues;
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe("cell_error");
        expect(issues[0].severity).toBe("blocking");
        expect(issues[0].displayText).toBe("#REF!");
      }
    });
  });

  describe("Resource safety limits", () => {
    it("rejects files exceeding 5MB size limit", async () => {
      const fakeFile = new File([new Uint8Array(10)], "large.xlsx");
      Object.defineProperty(fakeFile, "size", { value: 6 * 1024 * 1024 });

      const result = await parseWorkbookFile(fakeFile);
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("file_too_large");
      }
    });

    it("rejects worksheets exceeding 2,000 data rows (2,001 physical rows)", async () => {
      const largeData: (string | number)[][] = [["HeaderA", "HeaderB"]];
      for (let i = 0; i <= MAX_DATA_ROWS_PER_SHEET; i++) {
        largeData.push([`User_${i}`, i]);
      }
      const bytes = createXlsxBuffer([{ name: "Sheet1", data: largeData }]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "too_many_rows.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("workbook_too_large");
        expect(result.message).toMatch(/contains more than 2000 data rows/i);
      }
    });

    it("accepts worksheets with exactly 2,000 data rows", async () => {
      const exactData: (string | number)[][] = [["HeaderA", "HeaderB"]];
      for (let i = 0; i < MAX_DATA_ROWS_PER_SHEET; i++) {
        exactData.push([`User_${i}`, i]);
      }
      const bytes = createXlsxBuffer([{ name: "Sheet1", data: exactData }]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "exact_rows.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets[0].rows).toHaveLength(2001);
      }
    });

    it("rejects workbooks exceeding 20 worksheets", async () => {
      const sheets = Array.from({ length: 21 }, (_, i) => ({
        name: `Sheet_${i + 1}`,
        data: [["A", "B"], [1, 2]],
      }));
      const bytes = createXlsxBuffer(sheets);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "too_many_sheets.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("workbook_too_large");
        expect(result.message).toMatch(/exceeds the limit of 20/i);
      }
    });

    it("rejects workbooks exceeding 10,000 total rows across worksheets", async () => {
      // 6 sheets with 1800 rows each = 10,800 total rows
      const sheetData: (string | number)[][] = [["Col1", "Col2"]];
      for (let i = 0; i < 1799; i++) {
        sheetData.push([`R_${i}`, i]);
      }
      const sheets = Array.from({ length: 6 }, (_, i) => ({
        name: `Sheet_${i + 1}`,
        data: sheetData,
      }));
      const bytes = createXlsxBuffer(sheets);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "too_many_total_rows.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("workbook_too_large");
        expect(result.message).toMatch(/exceeds the maximum limit of 10000/i);
      }
    });

    it("rejects worksheets exceeding 100 columns", async () => {
      const headerRow = Array.from({ length: 101 }, (_, i) => `Col_${i + 1}`);
      const dataRow = Array.from({ length: 101 }, (_, i) => i + 1);
      const bytes = createXlsxBuffer([{ name: "WideSheet", data: [headerRow, dataRow] }]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "wide_sheet.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("workbook_too_large");
        expect(result.message).toMatch(/exceeding the maximum limit of 100 columns/i);
      }
    });
  });

  describe("Format validation, encryption, Unicode & formatting edge cases", () => {
    it("rejects unsupported file extensions with unsupported_format error", async () => {
      const bytes = new TextEncoder().encode("%PDF-1.4 Fake PDF Content");

      const result = await parseWorkbookBytes(bytes, {
        fileName: "document.pdf",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("unsupported_format");
        expect(result.message).toMatch(/unsupported file format/i);
      }
    });

    it("handles password protected/encrypted workbooks gracefully with encrypted error code", async () => {
      // OLE2 header with EncryptedPackage structure causing SheetJS to throw password error
      const ole2EncryptedHeader = new Uint8Array([
        0xd0, 0xcf, 0x11, 0xe0, 0xA1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3e, 0x00, 0x03, 0x00, 0xfe, 0xff, 0x09, 0x00,
        0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0xfe, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0xfe, 0xff, 0xff, 0xff,
      ]);

      const result = await parseWorkbookBytes(ole2EncryptedHeader, {
        fileName: "protected.xlsx",
        fileSize: ole2EncryptedHeader.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(["encrypted", "malformed"]).toContain(result.code);
      }
    });

    it("preserves Unicode characters, non-ASCII player names, and emojis", async () => {
      const bytes = createXlsxBuffer([
        {
          name: "UnicodeRoster",
          data: [
            ["Player", "THP", "Role"],
            ["🐉 Mätrix_Üser", "450.000.000", "Rôlë_Â1"],
            ["王小明", "100,000,000", "R4"],
          ],
        },
      ]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "unicode_roster.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets[0].rows[1]).toEqual(["🐉 Mätrix_Üser", "450.000.000", "Rôlë_Â1"]);
        expect(result.workbook.sheets[0].rows[2]).toEqual(["王小明", "100,000,000", "R4"]);
      }
    });

    it("handles sparse blank cells cleanly as empty strings", async () => {
      const bytes = createXlsxBuffer([
        {
          name: "SparseSheet",
          data: [
            ["Player", "THP", "Role"],
            ["Alice", null, "R4"],
            [null, "200", null],
          ],
        },
      ]);

      const result = await parseWorkbookBytes(bytes, {
        fileName: "sparse.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets[0].rows[1]).toEqual(["Alice", "", "R4"]);
        expect(result.workbook.sheets[0].rows[2]).toEqual(["", "200", ""]);
      }
    });

    it("preserves formatted display text for formatted numbers and date cells", async () => {
      const bytes = createXlsxBuffer(
        [
          {
            name: "FormattedData",
            data: [
              ["Player", "FormattedPower", "JoinDate"],
              ["Bob", 1234567, "2026-07-24"],
            ],
          },
        ],
        (ws) => {
          if (ws["B2"]) {
            ws["B2"].z = "$#,##0.00";
          }
          if (ws["C2"]) {
            ws["C2"].z = "yyyy-mm-dd";
          }
        }
      );

      const result = await parseWorkbookBytes(bytes, {
        fileName: "formatted.xlsx",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("workbook");
      if (result.kind === "workbook") {
        expect(result.workbook.sheets[0].rows[1][0]).toBe("Bob");
        expect(result.workbook.sheets[0].rows[1][1]).toMatch(/1,?234,?567/);
      }
    });
  });

  describe("Apple Numbers detection & encrypted/malformed handling", () => {
    it("detects .numbers extension and returns numbers_export_required", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const result = await parseWorkbookBytes(bytes, {
        fileName: "alliance_sheet.numbers",
        fileSize: bytes.length,
      });

      expect(result.kind).toBe("numbers_export_required");
    });

    it("detects .numbers signature inside ZIP container", async () => {
      const zipHeader = [0x50, 0x4b, 0x03, 0x04];
      const sig = new TextEncoder().encode("Index/Document.iwa plist QuickLook/Thumbnail.jpg");
      const combined = new Uint8Array(zipHeader.length + sig.length);
      combined.set(zipHeader, 0);
      combined.set(sig, zipHeader.length);

      const result = await parseWorkbookBytes(combined, {
        fileName: "unnamed.zip",
        fileSize: combined.length,
      });

      expect(result.kind).toBe("numbers_export_required");
    });

    it("returns malformed error for corrupt non-spreadsheet bytes", async () => {
      const corruptBytes = new Uint8Array([0x00, 0xff, 0xfe, 0xfa, 0x12]);

      const result = await parseWorkbookBytes(corruptBytes, {
        fileName: "corrupt.xlsx",
        fileSize: corruptBytes.length,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.code).toBe("malformed");
      }
    });
  });
});
