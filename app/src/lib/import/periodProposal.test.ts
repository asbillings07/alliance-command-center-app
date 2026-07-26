import { describe, it, expect } from "vitest";
import {
  parseDateHeader,
  extractYearFromSheetName,
  isValidCalendarDate,
  isLocaleAmbiguousShorthand,
} from "./dateHeaderParser";
import { analyzeDerivedColumn } from "./derivedColumnDetector";
import { buildPeriodMappingReview } from "./periodProposal";
import { cellAddress } from "@/app/src/lib/memberMatcher";

describe("dateHeaderParser", () => {
  it("extracts year from sheet name", () => {
    expect(extractYearFromSheetName("March 2026")).toBe(2026);
    expect(extractYearFromSheetName("Q1 2026 Results")).toBe(2026);
    expect(extractYearFromSheetName("Roster Data")).toBeNull();
  });

  it("parses single-date snapshot headers with sheet-name year inference", () => {
    const res = parseDateHeader("Kills on 3/29", { sheetName: "March 2026" });
    expect(res.hasDateEvidence).toBe(true);
    expect(res.metricStem).toBe("Kills");
    expect(res.dateEvidence?.kind).toBe("snapshot");
    expect(res.dateEvidence?.start).toEqual({ month: 3, day: 29, year: 2026 });
    expect(res.dateEvidence?.yearSource).toBe("sheet_name");
    expect(res.dateEvidence?.isLocaleAmbiguous).toBe(false);
  });

  it("parses explicit-year snapshot headers as header year source", () => {
    const res = parseDateHeader("Hero Power as of 2026-07-18");
    expect(res.hasDateEvidence).toBe(true);
    expect(res.dateEvidence?.yearSource).toBe("header");
    expect(res.dateEvidence?.start).toEqual({ month: 7, day: 18, year: 2026 });
  });

  it("marks yearless headers without sheet context as unresolved (not current year)", () => {
    const res = parseDateHeader("Kills on 3/29");
    expect(res.dateEvidence?.yearSource).toBe("unresolved");
    expect(res.dateEvidence?.start.year).toBeUndefined();
    expect(res.dateEvidence?.ambiguities).toContainEqual(
      "Year could not be determined; please confirm the year for this period",
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateHeader("Kills on 2/30").hasDateEvidence).toBe(false);
    expect(parseDateHeader("Kills on 13/1").hasDateEvidence).toBe(false);
    expect(parseDateHeader("Kills on 4/31").hasDateEvidence).toBe(false);
    expect(isValidCalendarDate({ month: 2, day: 30, year: 2026 })).toBe(false);
  });

  it("flags locale-ambiguous shorthand like 3/4", () => {
    expect(isLocaleAmbiguousShorthand(3, 4)).toBe(true);
    const res = parseDateHeader("Kills on 3/4", { sheetName: "March 2026" });
    expect(res.dateEvidence?.isLocaleAmbiguous).toBe(true);
  });

  it("parses date-range headers and supports cross-year ranges from sheet context", () => {
    const res = parseDateHeader("Total Kills from 12/15-1/15", { sheetName: "January 2026" });
    expect(res.dateEvidence?.kind).toBe("range");
    expect(res.dateEvidence?.start).toEqual({ month: 12, day: 15, year: 2026 });
    expect(res.dateEvidence?.end).toEqual({ month: 1, day: 15, year: 2027 });
  });

  it("flags reversed ranges when end precedes start", () => {
    const res = parseDateHeader("Kills from 4/13-3/29", { sheetName: "March 2026" });
    expect(res.dateEvidence?.isReversedRange).toBe(true);
  });

  it("returns no date evidence for plain headers", () => {
    expect(parseDateHeader("VS Score").hasDateEvidence).toBe(false);
  });
});

describe("derivedColumnDetector", () => {
  it("detects percentage, rank, delta, and aggregate_range columns with reasons", () => {
    expect(analyzeDerivedColumn("% Change").reason).toBe("percentage");
    expect(analyzeDerivedColumn("Alliance Rank #").reason).toBe("rank");
    expect(analyzeDerivedColumn("Weekly WoW Change").reason).toBe("delta");
    expect(analyzeDerivedColumn("Total Kills from 3/29 to 4/13").reason).toBe("aggregate_range");
  });
});

describe("buildPeriodMappingReview", () => {
  const headerRowIndex = 2;

  function header(
    columnIndex: number,
    headerText: string,
    opts?: { isPlayerColumn?: boolean; isNumeric?: boolean },
  ) {
    return {
      columnIndex,
      headerText,
      headerAddress: cellAddress(headerRowIndex, columnIndex),
      isPlayerColumn: opts?.isPlayerColumn,
      isNumeric: opts?.isNumeric,
    };
  }

  it("builds multi_period for golden workbook with snapshots, ranges, and derived columns", () => {
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      tableRegionId: "region-0",
      headerRowIndex,
      headers: [
        header(0, "Player", { isPlayerColumn: true, isNumeric: false }),
        header(1, "Kills on 3/29", { isNumeric: true }),
        header(2, "Hero Power on 3/29", { isNumeric: true }),
        header(3, "Kills on 4/13", { isNumeric: true }),
        header(4, "Kills from 3/29-4/13", { isNumeric: true }),
        header(5, "% Change", { isNumeric: true }),
        header(6, "Rank #", { isNumeric: true }),
      ],
    });

    expect(review.mode).toBe("multi_period");
    expect(review.tableRegionId).toBe("region-0");
    expect(review.headerRowIndex).toBe(headerRowIndex);
    expect(review.proposals.length).toBeGreaterThanOrEqual(2);
    expect(review.excludedColumns.some((c) => c.reason === "derived" && c.derivedReason === "percentage")).toBe(true);
    expect(review.excludedColumns.some((c) => c.reason === "derived" && c.derivedReason === "rank")).toBe(true);
    expect(review.proposals.every((p) => p.confidence === "medium")).toBe(true);
    expect(review.proposals[0].columns[0].headerAddress).toBe("B3");
  });

  it("does not declare multi_period for a single temporal group at medium confidence", () => {
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headerRowIndex: 0,
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "Kills on 3/29", { isNumeric: true }),
        header(2, "Hero Power on 3/29", { isNumeric: true }),
      ],
    });

    expect(review.proposals).toHaveLength(1);
    expect(review.proposals[0].confidence).toBe("medium");
    expect(review.mode).toBe("insufficient_evidence");
  });

  it("allows single-group multi_period only at high confidence with explicit header year", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Roster Data",
      headerRowIndex: 0,
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "Kills on 3/29/2026", { isNumeric: true }),
        header(2, "Hero Power on 3/29/2026", { isNumeric: true }),
      ],
    });

    expect(review.proposals).toHaveLength(1);
    expect(review.proposals[0].confidence).toBe("high");
    expect(review.mode).toBe("multi_period");
  });

  it("excludes non-numeric columns with date-like headers", () => {
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headerRowIndex: 0,
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "Notes on 3/29", { isNumeric: false }),
        header(2, "Kills on 3/29", { isNumeric: true }),
        header(3, "Kills on 4/13", { isNumeric: true }),
      ],
    });

    expect(review.excludedColumns.some((c) => c.reason === "non_numeric")).toBe(true);
    expect(review.mode).toBe("multi_period");
  });

  it("excludes locale-ambiguous and invalid dates from proposals", () => {
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headerRowIndex: 0,
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "Kills on 3/4", { isNumeric: true }),
        header(2, "Kills on 2/30", { isNumeric: true }),
        header(3, "Kills on 3/29", { isNumeric: true }),
        header(4, "Kills on 4/13", { isNumeric: true }),
      ],
    });

    expect(review.excludedColumns.some((c) => c.reason === "locale_ambiguous")).toBe(true);
    expect(review.excludedColumns.some((c) => c.reason === "invalid_date")).toBe(true);
    expect(review.mode).toBe("multi_period");
  });

  it("excludes yearless columns without sheet year context and stays insufficient_evidence", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Sheet1",
      headerRowIndex: 0,
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "Kills on 3/29", { isNumeric: true }),
        header(2, "Kills on 4/13", { isNumeric: true }),
      ],
    });

    expect(review.excludedColumns.every((c) => c.reason === "unresolved_year" || c.reason === "player_column")).toBe(true);
    expect(review.proposals).toHaveLength(0);
    expect(review.mode).toBe("insufficient_evidence");
  });

  it("uses typed date header metadata for high confidence and evidence warnings", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Roster",
      headerRowIndex: 0,
      cellDates: {
        B1: {
          address: "B1",
          rowIndex: 0,
          columnIndex: 1,
          formattedText: "3/29/2026",
          isTypedDate: true,
        },
      },
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "Kills on 3/29/2026", { isNumeric: true }),
      ],
    });

    expect(review.proposals[0].confidence).toBe("high");
    expect(review.proposals[0].columns[0].hasTypedDateHeader).toBe(true);
    expect(review.proposals[0].warnings.some((w) => w.includes("Excel typed-date"))).toBe(true);
    expect(review.mode).toBe("multi_period");
  });

  it("returns insufficient_evidence when headers lack date evidence", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Sheet1",
      headerRowIndex: 0,
      headers: [
        header(0, "Player", { isPlayerColumn: true }),
        header(1, "VS Kills", { isNumeric: true }),
        header(2, "Hero Power", { isNumeric: true }),
      ],
    });

    expect(review.mode).toBe("insufficient_evidence");
    expect(review.proposals).toHaveLength(0);
  });
});
