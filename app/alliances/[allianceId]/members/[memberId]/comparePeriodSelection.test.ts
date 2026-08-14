import { describe, it, expect } from "vitest";
import {
  resolveComparePeriodSelection,
  formatComparePeriodLabel,
  type ComparePeriodHeader,
} from "./comparePeriodSelection";

function header(
  id: string,
  name: string,
  startsAt: Date | null = null,
  endsAt: Date | null = null,
  createdAt: Date = new Date("2026-01-01"),
): ComparePeriodHeader {
  return { id, name, startsAt, endsAt, createdAt };
}

const week18 = header("week-18", "Week 18");
const week17 = header("week-17", "Week 17");

describe("resolveComparePeriodSelection", () => {
  describe("when eligible periods exist", () => {
    const eligiblePeriods = [week18, week17];

    it("omitted -> defaults to the nearest eligible period, not canonical", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: undefined,
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "period", comparePeriod: week18, isCanonical: false });
    });

    it("'none' -> explicit-none, canonical", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "none",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "explicit-none", isCanonical: true });
    });

    it("'no-prior' -> invalid when eligible periods actually exist", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "no-prior",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "invalid" });
    });

    it("a valid eligible id -> resolved period, canonical", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "week-17",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "period", comparePeriod: week17, isCanonical: true });
    });

    it("an id not in the eligible set (wrong alliance, same/newer period, nonexistent) -> invalid", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "some-other-period",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "invalid" });
    });
  });

  describe("when no eligible periods exist (first-ever period)", () => {
    const eligiblePeriods: ComparePeriodHeader[] = [];

    it("omitted -> no-prior-period, not canonical", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: undefined,
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "no-prior-period", isCanonical: false });
    });

    it("'no-prior' -> no-prior-period, canonical", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "no-prior",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "no-prior-period", isCanonical: true });
    });

    it("'none' -> invalid - nothing was ever offered to decline", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "none",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "invalid" });
    });

    it("any other id -> invalid", () => {
      const result = resolveComparePeriodSelection({
        requestedComparePeriodId: "week-18",
        eligiblePeriods,
      });
      expect(result).toEqual({ status: "invalid" });
    });
  });
});

describe("formatComparePeriodLabel", () => {
  it("falls back to createdAt (not the bare name) when both dates are unset", () => {
    const label = formatComparePeriodLabel(week18);
    expect(label).toContain("Week 18");
    expect(label).toContain(week18.createdAt.toLocaleDateString());
  });

  it("appends a disambiguating date range when both dates are set", () => {
    const dated = header("week-18-a", "Week 18", new Date("2026-08-03"), new Date("2026-08-09"));
    const label = formatComparePeriodLabel(dated);
    expect(label).toContain("Week 18");
    expect(label).toContain(dated.startsAt!.toLocaleDateString());
    expect(label).toContain(dated.endsAt!.toLocaleDateString());
  });

  it("uses startsAt alone when endsAt is unset", () => {
    const partial = header("week-18-b", "Week 18", new Date("2026-08-03"), null);
    const label = formatComparePeriodLabel(partial);
    expect(label).toContain(partial.startsAt!.toLocaleDateString());
  });

  it("uses endsAt alone when startsAt is unset", () => {
    const partial = header("week-18-c", "Week 18", null, new Date("2026-08-09"));
    const label = formatComparePeriodLabel(partial);
    expect(label).toContain(partial.endsAt!.toLocaleDateString());
  });

  it("disambiguates two periods that share a name via their date ranges", () => {
    const first = header("a", "Week 18", new Date("2026-08-03"), new Date("2026-08-09"));
    const second = header("b", "Week 18", new Date("2026-08-10"), new Date("2026-08-16"));
    expect(formatComparePeriodLabel(first)).not.toBe(formatComparePeriodLabel(second));
  });

  it("disambiguates two same-named, fully undated periods via createdAt", () => {
    const first = header("a", "Week 18", null, null, new Date("2026-01-01"));
    const second = header("b", "Week 18", null, null, new Date("2026-02-01"));
    expect(formatComparePeriodLabel(first)).not.toBe(formatComparePeriodLabel(second));
  });
});
