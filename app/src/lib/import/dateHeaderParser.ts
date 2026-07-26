export type ParsedDateComponent = {
  month: number;
  day: number;
  year?: number;
};

export type ParsedDateEvidence = {
  kind: "snapshot" | "range";
  start: ParsedDateComponent;
  end: ParsedDateComponent;
  yearSource: "header" | "sheet_name" | "inferred_default";
  ambiguities: string[];
};

export type DateHeaderParseResult = {
  hasDateEvidence: boolean;
  metricStem: string | null; // e.g. "Kills" from "Kills on 5/3"
  dateEvidence: ParsedDateEvidence | null;
  rawHeader: string;
};

// Extract year from sheet name like "March 2026", "Q1 2026", "2026-03"
export function extractYearFromSheetName(sheetName: string): number | null {
  const match = sheetName.match(/\b(20\d{2})\b/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseDateStr(str: string): ParsedDateComponent | null {
  const trimmed = str.trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { year: y, month: m, day: d };
    }
  }

  // MM/DD/YYYY or M/D/YY
  const mdyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})$/);
  if (mdyMatch) {
    const m = parseInt(mdyMatch[1], 10);
    const d = parseInt(mdyMatch[2], 10);
    let y = parseInt(mdyMatch[3], 10);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { year: y, month: m, day: d };
    }
  }

  // MM/DD or M/D
  const mdMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (mdMatch) {
    const m = parseInt(mdMatch[1], 10);
    const d = parseInt(mdMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { month: m, day: d };
    }
  }

  // Month Name Day, e.g. "March 29" or "Mar 29, 2026"
  const nameMatch = trimmed.match(/^([a-z]+)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?$/i);
  if (nameMatch) {
    const mName = nameMatch[1].toLowerCase();
    const m = MONTH_NAMES[mName];
    const d = parseInt(nameMatch[2], 10);
    const y = nameMatch[3] ? parseInt(nameMatch[3], 10) : undefined;
    if (m && d >= 1 && d <= 31) {
      return { month: m, day: d, year: y };
    }
  }

  return null;
}

export function parseDateHeader(
  header: string,
  options?: { sheetName?: string; defaultYear?: number }
): DateHeaderParseResult {
  const rawHeader = header.trim();
  const sheetYear = options?.sheetName ? extractYearFromSheetName(options.sheetName) : null;
  const fallbackYear = options?.defaultYear ?? new Date().getFullYear();

  if (!rawHeader) {
    return { hasDateEvidence: false, metricStem: null, dateEvidence: null, rawHeader };
  }

  // 1. Check for Range patterns:
  // e.g., "Kills from 3/29-4/13", "3/29 to 4/13", "3/29 - 4/13", "Total Kills (3/29 – 4/13)"
  const rangeRegex = /^(.*?)(?:\bfrom\b|\bbetween\b|\()?[\s:]*(\d{1,2}[-/.]\d{1,2}(?:[-/.](?:20\d{2}|\d{2}))?)\s*(?:to|through|–|-|—)\s*(\d{1,2}[-/.]\d{1,2}(?:[-/.](?:20\d{2}|\d{2}))?)\)?$/i;
  const rangeMatch = rawHeader.match(rangeRegex);

  if (rangeMatch) {
    const stemPart = rangeMatch[1].replace(/\b(from|between|for|during)\b/gi, "").replace(/[\(\):,-]/g, "").trim();
    const d1Str = rangeMatch[2];
    const d2Str = rangeMatch[3];

    const d1 = parseDateStr(d1Str);
    const d2 = parseDateStr(d2Str);

    if (d1 && d2) {
      const ambiguities: string[] = [];
      let yearSource: "header" | "sheet_name" | "inferred_default" = "header";

      let finalYear1 = d1.year;
      let finalYear2 = d2.year;

      if (!finalYear1 || !finalYear2) {
        if (sheetYear) {
          yearSource = "sheet_name";
          finalYear1 = finalYear1 ?? sheetYear;
          finalYear2 = finalYear2 ?? sheetYear;
          ambiguities.push(`Year missing in header; inferred ${sheetYear} from worksheet name ("${options?.sheetName}")`);
        } else {
          yearSource = "inferred_default";
          finalYear1 = finalYear1 ?? fallbackYear;
          finalYear2 = finalYear2 ?? fallbackYear;
          ambiguities.push(`Year missing in header; inferred current year ${fallbackYear}`);
        }
      }

      const metricStem = stemPart.length > 0 ? stemPart : null;

      return {
        hasDateEvidence: true,
        metricStem,
        dateEvidence: {
          kind: "range",
          start: { month: d1.month, day: d1.day, year: finalYear1 },
          end: { month: d2.month, day: d2.day, year: finalYear2 },
          yearSource,
          ambiguities,
        },
        rawHeader,
      };
    }
  }

  // 2. Check for Snapshot patterns:
  // e.g., "Kills on 3/29", "Kills 3/29/2026", "Kills (3/29)", "3/29", "2026-03-29"
  const snapshotRegex = /^(.*?)(?:\bon\b|\bas of\b|\bat\b)?[\s:]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.](?:20\d{2}|\d{2}))?|\b[a-z]+\s+\d{1,2}(?:[,\s]+20\d{2})?)\)?$/i;
  const snapshotMatch = rawHeader.match(snapshotRegex);

  if (snapshotMatch) {
    const stemPart = snapshotMatch[1].replace(/\b(on|as of|at|for|date)\b/gi, "").replace(/[\(\):,-]/g, "").trim();
    const dateStr = snapshotMatch[2];
    const parsed = parseDateStr(dateStr);

    if (parsed) {
      const ambiguities: string[] = [];
      let yearSource: "header" | "sheet_name" | "inferred_default" = "header";

      let finalYear = parsed.year;
      if (!finalYear) {
        if (sheetYear) {
          yearSource = "sheet_name";
          finalYear = sheetYear;
          ambiguities.push(`Year missing in header; inferred ${sheetYear} from worksheet name ("${options?.sheetName}")`);
        } else {
          yearSource = "inferred_default";
          finalYear = fallbackYear;
          ambiguities.push(`Year missing in header; inferred current year ${fallbackYear}`);
        }
      }

      const metricStem = stemPart.length > 0 ? stemPart : null;

      return {
        hasDateEvidence: true,
        metricStem,
        dateEvidence: {
          kind: "snapshot",
          start: { month: parsed.month, day: parsed.day, year: finalYear },
          end: { month: parsed.month, day: parsed.day, year: finalYear },
          yearSource,
          ambiguities,
        },
        rawHeader,
      };
    }
  }

  return {
    hasDateEvidence: false,
    metricStem: null,
    dateEvidence: null,
    rawHeader,
  };
}
