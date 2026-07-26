export type ParsedDateComponent = {
  month: number;
  day: number;
  year?: number;
};

export type YearSource = "header" | "sheet_name" | "unresolved";

export type ParsedDateEvidence = {
  kind: "snapshot" | "range";
  start: ParsedDateComponent;
  end: ParsedDateComponent;
  yearSource: YearSource;
  ambiguities: string[];
  /** True when M/D shorthand could mean either month/day order (e.g. 3/4). */
  isLocaleAmbiguous: boolean;
  /** False when the calendar date is impossible (e.g. 2/30). */
  isCalendarValid: boolean;
  /** Range end is chronologically before start (after year resolution). */
  isReversedRange: boolean;
};

export type DateHeaderParseResult = {
  hasDateEvidence: boolean;
  metricStem: string | null;
  dateEvidence: ParsedDateEvidence | null;
  rawHeader: string;
  /** Header matched a date pattern but calendar validation failed (e.g. 2/30). */
  invalidDateAttempt?: boolean;
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

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(month: number, year?: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    if (year !== undefined) return isLeapYear(year) ? 29 : 28;
    return 29;
  }
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

export function isValidCalendarDate(c: ParsedDateComponent): boolean {
  if (c.month < 1 || c.month > 12 || c.day < 1) return false;
  if (c.year !== undefined) {
    return c.day <= daysInMonth(c.month, c.year);
  }
  if (c.month === 2 && c.day > 29) return false;
  if ([4, 6, 9, 11].includes(c.month) && c.day > 30) return false;
  return c.day <= 31;
}

/** M/D shorthand where both parts could be month or day (e.g. 3/4). */
export function isLocaleAmbiguousShorthand(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 12 && month !== day;
}

type ParsedDateStrResult = {
  component: ParsedDateComponent;
  isLocaleAmbiguous: boolean;
};

function parseDateStr(str: string): ParsedDateStrResult | null {
  const trimmed = str.trim();

  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const component: ParsedDateComponent = {
      year: parseInt(isoMatch[1], 10),
      month: parseInt(isoMatch[2], 10),
      day: parseInt(isoMatch[3], 10),
    };
    if (!isValidCalendarDate(component)) return null;
    return { component, isLocaleAmbiguous: false };
  }

  const mdyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})$/);
  if (mdyMatch) {
    const m = parseInt(mdyMatch[1], 10);
    const d = parseInt(mdyMatch[2], 10);
    let y = parseInt(mdyMatch[3], 10);
    if (y < 100) y += 2000;
    const component: ParsedDateComponent = { year: y, month: m, day: d };
    if (!isValidCalendarDate(component)) return null;
    return { component, isLocaleAmbiguous: false };
  }

  const mdMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (mdMatch) {
    const m = parseInt(mdMatch[1], 10);
    const d = parseInt(mdMatch[2], 10);
    const component: ParsedDateComponent = { month: m, day: d };
    if (!isValidCalendarDate(component)) return null;
    return {
      component,
      isLocaleAmbiguous: isLocaleAmbiguousShorthand(m, d),
    };
  }

  const nameMatch = trimmed.match(/^([a-z]+)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?$/i);
  if (nameMatch) {
    const mName = nameMatch[1].toLowerCase();
    const m = MONTH_NAMES[mName];
    const d = parseInt(nameMatch[2], 10);
    const y = nameMatch[3] ? parseInt(nameMatch[3], 10) : undefined;
    if (!m) return null;
    const component: ParsedDateComponent = { month: m, day: d, year: y };
    if (!isValidCalendarDate(component)) return null;
    return { component, isLocaleAmbiguous: false };
  }

  return null;
}

function compareResolvedDates(
  a: ParsedDateComponent,
  b: ParsedDateComponent,
): number {
  const yA = a.year ?? 0;
  const yB = b.year ?? 0;
  if (yA !== yB) return yA - yB;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function resolveYears(
  d1: ParsedDateComponent,
  d2: ParsedDateComponent,
  sheetYear: number | null,
): {
  start: ParsedDateComponent;
  end: ParsedDateComponent;
  yearSource: YearSource;
  ambiguities: string[];
} {
  const ambiguities: string[] = [];
  let yearSource: YearSource = "header";

  const start: ParsedDateComponent = { ...d1 };
  const end: ParsedDateComponent = { ...d2 };

  const startHasYear = start.year !== undefined;
  const endHasYear = end.year !== undefined;

  if (startHasYear && endHasYear) {
    return { start, end, yearSource: "header", ambiguities };
  }

  if (sheetYear !== null) {
    yearSource = "sheet_name";
    if (!startHasYear) start.year = sheetYear;
    if (!endHasYear) end.year = sheetYear;
    if (!startHasYear || !endHasYear) {
      ambiguities.push(
        `Year missing in header; inferred ${sheetYear} from worksheet name`,
      );
    }

    // Cross-year range within sheet context (e.g. 12/15–1/15), not a simple reversal
    if (
      compareResolvedDates(start, end) > 0 &&
      start.year === end.year &&
      !startHasYear &&
      !endHasYear &&
      start.month > end.month &&
      start.month >= 11 &&
      end.month <= 3
    ) {
      end.year = sheetYear + 1;
      ambiguities.push(
        `Range spans a year boundary; end date assigned to ${end.year}`,
      );
    }

    return { start, end, yearSource, ambiguities };
  }

  yearSource = "unresolved";
  ambiguities.push(
    "Year could not be determined; please confirm the year for this period",
  );
  return { start, end, yearSource, ambiguities };
}

function resolveSnapshotYear(
  parsed: ParsedDateComponent,
  sheetYear: number | null,
): {
  component: ParsedDateComponent;
  yearSource: YearSource;
  ambiguities: string[];
} {
  if (parsed.year !== undefined) {
    return {
      component: parsed,
      yearSource: "header",
      ambiguities: [],
    };
  }

  if (sheetYear !== null) {
    return {
      component: { ...parsed, year: sheetYear },
      yearSource: "sheet_name",
      ambiguities: [
        `Year missing in header; inferred ${sheetYear} from worksheet name`,
      ],
    };
  }

  return {
    component: parsed,
    yearSource: "unresolved",
    ambiguities: [
      "Year could not be determined; please confirm the year for this period",
    ],
  };
}

function buildDateEvidence(
  kind: "snapshot" | "range",
  start: ParsedDateComponent,
  end: ParsedDateComponent,
  yearSource: YearSource,
  ambiguities: string[],
  isLocaleAmbiguous: boolean,
): ParsedDateEvidence {
  const isCalendarValid =
    isValidCalendarDate(start) &&
    (kind === "snapshot" || isValidCalendarDate(end));

  let isReversedRange = false;
  if (
    kind === "range" &&
    start.year !== undefined &&
    end.year !== undefined &&
    isCalendarValid
  ) {
    isReversedRange = compareResolvedDates(start, end) > 0;
    if (isReversedRange) {
      ambiguities.push(
        "Range end date is before start date; verify the intended period window",
      );
    }
  }

  const allAmbiguities = [...ambiguities];
  if (isLocaleAmbiguous) {
    allAmbiguities.push(
      "Date shorthand is locale-ambiguous (e.g. 3/4 could be March 4 or April 3); please confirm",
    );
  }

  return {
    kind,
    start,
    end,
    yearSource,
    ambiguities: allAmbiguities,
    isLocaleAmbiguous,
    isCalendarValid,
    isReversedRange,
  };
}

export function parseDateHeader(
  header: string,
  options?: { sheetName?: string },
): DateHeaderParseResult {
  const rawHeader = header.trim();
  const sheetYear = options?.sheetName
    ? extractYearFromSheetName(options.sheetName)
    : null;

  if (!rawHeader) {
    return { hasDateEvidence: false, metricStem: null, dateEvidence: null, rawHeader };
  }

  const rangeRegex =
    /^(.*?)(?:\bfrom\b|\bbetween\b|\()?[\s:]*(\d{1,2}[-/.]\d{1,2}(?:[-/.](?:20\d{2}|\d{2}))?|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:to|through|–|-|—)\s*(\d{1,2}[-/.]\d{1,2}(?:[-/.](?:20\d{2}|\d{2}))?|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\)?$/i;
  const rangeMatch = rawHeader.match(rangeRegex);

  if (rangeMatch) {
    const stemPart = rangeMatch[1]
      .replace(/\b(from|between|for|during)\b/gi, "")
      .replace(/[\(\):,-]/g, "")
      .trim();
    const d1Parsed = parseDateStr(rangeMatch[2]);
    const d2Parsed = parseDateStr(rangeMatch[3]);

    if (d1Parsed && d2Parsed) {
      const resolved = resolveYears(
        d1Parsed.component,
        d2Parsed.component,
        sheetYear,
      );
      const isLocaleAmbiguous =
        d1Parsed.isLocaleAmbiguous || d2Parsed.isLocaleAmbiguous;

      return {
        hasDateEvidence: true,
        metricStem: stemPart.length > 0 ? stemPart : null,
        dateEvidence: buildDateEvidence(
          "range",
          resolved.start,
          resolved.end,
          resolved.yearSource,
          resolved.ambiguities,
          isLocaleAmbiguous,
        ),
        rawHeader,
      };
    }

    return {
      hasDateEvidence: false,
      metricStem: stemPart.length > 0 ? stemPart : null,
      dateEvidence: null,
      rawHeader,
      invalidDateAttempt: true,
    };
  }

  const snapshotRegex =
    /^(.*?)(?:\bon\b|\bas of\b|\bat\b)?[\s:]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.](?:20\d{2}|\d{2}))?|\b[a-z]+\s+\d{1,2}(?:[,\s]+20\d{2})?)\)?$/i;
  const snapshotMatch = rawHeader.match(snapshotRegex);

  if (snapshotMatch) {
    const stemPart = snapshotMatch[1]
      .replace(/\b(on|as of|at|for|date)\b/gi, "")
      .replace(/[\(\):,-]/g, "")
      .trim();
    const parsed = parseDateStr(snapshotMatch[2]);

    if (parsed) {
      const resolved = resolveSnapshotYear(parsed.component, sheetYear);

      return {
        hasDateEvidence: true,
        metricStem: stemPart.length > 0 ? stemPart : null,
        dateEvidence: buildDateEvidence(
          "snapshot",
          resolved.component,
          resolved.component,
          resolved.yearSource,
          resolved.ambiguities,
          parsed.isLocaleAmbiguous,
        ),
        rawHeader,
      };
    }

    return {
      hasDateEvidence: false,
      metricStem: stemPart.length > 0 ? stemPart : null,
      dateEvidence: null,
      rawHeader,
      invalidDateAttempt: true,
    };
  }

  return {
    hasDateEvidence: false,
    metricStem: null,
    dateEvidence: null,
    rawHeader,
  };
}
