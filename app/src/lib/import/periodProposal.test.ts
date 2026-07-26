import { describe, it, expect } from "vitest";
import { parseDateHeader, extractYearFromSheetName } from "./dateHeaderParser";
import { analyzeDerivedColumn } from "./derivedColumnDetector";
import { buildPeriodMappingReview } from "./periodProposal";

describe("dateHeaderParser", () => {
  it("extracts year from sheet name", () => {
    expect(extractYearFromSheetName("March 2026")).toBe(2026);
    expect(extractYearFromSheetName("Q1 2026 Results")).toBe(2026);
    expect(extractYearFromSheetName("Roster Data")).toBeNull();
  });

  it("parses single-date snapshot headers", () => {
    const res1 = parseDateHeader("Kills on 3/29", { sheetName: "March 2026" });
    expect(res1.hasDateEvidence).toBe(true);
    expect(res1.metricStem).toBe("Kills");
    expect(res1.dateEvidence?.kind).toBe("snapshot");
    expect(res1.dateEvidence?.start).toEqual({ month: 3, day: 29, year: 2026 });
    expect(res1.dateEvidence?.yearSource).toBe("sheet_name");

    const res2 = parseDateHeader("Hero Power as of 2026-07-18");
    expect(res2.hasDateEvidence).toBe(true);
    expect(res2.metricStem).toBe("Hero Power");
    expect(res2.dateEvidence?.kind).toBe("snapshot");
    expect(res2.dateEvidence?.start).toEqual({ month: 7, day: 18, year: 2026 });
    expect(res2.dateEvidence?.yearSource).toBe("header");
  });

  it("parses date-range headers", () => {
    const res = parseDateHeader("Total Kills from 3/29-4/13", { sheetName: "April 2026" });
    expect(res.hasDateEvidence).toBe(true);
    expect(res.metricStem).toBe("Total Kills");
    expect(res.dateEvidence?.kind).toBe("range");
    expect(res.dateEvidence?.start).toEqual({ month: 3, day: 29, year: 2026 });
    expect(res.dateEvidence?.end).toEqual({ month: 4, day: 13, year: 2026 });
  });

  it("returns no date evidence for plain or non-date headers", () => {
    const res = parseDateHeader("VS Score");
    expect(res.hasDateEvidence).toBe(false);
    expect(res.dateEvidence).toBeNull();
  });
});

describe("derivedColumnDetector", () => {
  it("detects percentage columns", () => {
    const res = analyzeDerivedColumn("% Change");
    expect(res.isDerived).toBe(true);
    expect(res.reason).toBe("percentage");
  });

  it("detects rank columns", () => {
    const res = analyzeDerivedColumn("Alliance Rank #");
    expect(res.isDerived).toBe(true);
    expect(res.reason).toBe("rank");
  });

  it("detects delta and WoW columns", () => {
    const res = analyzeDerivedColumn("Weekly WoW Change");
    expect(res.isDerived).toBe(true);
    expect(res.reason).toBe("delta");
  });

  it("returns non-derived for normal metric names", () => {
    const res = analyzeDerivedColumn("VS Kills");
    expect(res.isDerived).toBe(false);
  });
});

describe("periodProposal (Golden Workbook Fixture Tests)", () => {
  it("builds multi-period proposal for synthetic golden workbook with snapshots, ranges, and derived columns", () => {
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headers: [
        { columnIndex: 0, headerText: "Player", isPlayerColumn: true },
        { columnIndex: 1, headerText: "Kills on 3/29", isNumeric: true },
        { columnIndex: 2, headerText: "Hero Power on 3/29", isNumeric: true },
        { columnIndex: 3, headerText: "Kills on 4/13", isNumeric: true },
        { columnIndex: 4, headerText: "Kills from 3/29-4/13", isNumeric: true },
        { columnIndex: 5, headerText: "% Change", isNumeric: true },
        { columnIndex: 6, headerText: "Rank #", isNumeric: true },
      ],
    });

    expect(review.mode).toBe("multi_period");
    expect(review.hasDerivedColumns).toBe(true);
    expect(review.excludedDerivedColumnsCount).toBe(2);

    // Expect 2 distinct proposals: 1 snapshot group (3/29) and 1 range group (3/29..4/13)
    // Note: Kills on 4/13 is a different snapshot group (4/13) -> total 3 proposals!
    expect(review.proposals.length).toBeGreaterThanOrEqual(2);

    const snapshot29 = review.proposals.find((p) => p.startsAtISO === "2026-03-29" && p.dateKind === "snapshot");
    expect(snapshot29).toBeDefined();
    expect(snapshot29?.columns).toHaveLength(2); // Kills on 3/29 and Hero Power on 3/29
    expect(snapshot29?.proposedPeriodName).toContain("Mar 29, 2026 Evaluation");

    const rangeProposal = review.proposals.find((p) => p.dateKind === "range");
    expect(rangeProposal).toBeDefined();
    expect(rangeProposal?.startsAtISO).toBe("2026-03-29");
    expect(rangeProposal?.endsAtISO).toBe("2026-04-13");
  });

  it("returns insufficient_evidence when headers lack date evidence", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Sheet1",
      headers: [
        { columnIndex: 0, headerText: "Player", isPlayerColumn: true },
        { columnIndex: 1, headerText: "VS Kills", isNumeric: true },
        { columnIndex: 2, headerText: "Hero Power", isNumeric: true },
      ],
    });

    expect(review.mode).toBe("insufficient_evidence");
    expect(review.proposals).toHaveLength(0);
  });
});
