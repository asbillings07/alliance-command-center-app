import { describe, it, expect } from "vitest";
import {
  isEligibleComparisonPeriod,
  findEligibleComparisonPeriods,
  pickDefaultComparisonPeriod,
  resolveComparisonPeriodSelection,
  type ComparablePeriodCandidate,
} from "./resolveComparablePeriod";

const selected = {
  startsAt: new Date("2026-04-01T00:00:00Z"),
  endsAt: new Date("2026-04-14T00:00:00Z"), // 13-day period
};

function candidate(overrides: Partial<ComparablePeriodCandidate>): ComparablePeriodCandidate {
  return {
    id: "period-1",
    name: "Period 1",
    startsAt: new Date("2026-03-18T00:00:00Z"),
    endsAt: new Date("2026-03-31T00:00:00Z"), // 13-day period, ends before selected starts
    createdAt: new Date("2026-03-18T00:00:00Z"),
    metricAttachedActive: true,
    ...overrides,
  };
}

describe("isEligibleComparisonPeriod", () => {
  it("accepts a prior period with the same duration and an active attachment", () => {
    expect(isEligibleComparisonPeriod(candidate({}), selected)).toBe(true);
  });

  it("rejects when the metric attachment is not active", () => {
    expect(
      isEligibleComparisonPeriod(candidate({ metricAttachedActive: false }), selected),
    ).toBe(false);
  });

  it("rejects when the selected period lacks startsAt/endsAt", () => {
    expect(
      isEligibleComparisonPeriod(candidate({}), { startsAt: null, endsAt: null }),
    ).toBe(false);
  });

  it("rejects when the candidate lacks startsAt/endsAt", () => {
    expect(
      isEligibleComparisonPeriod(candidate({ startsAt: null, endsAt: null }), selected),
    ).toBe(false);
  });

  it("rejects a candidate that shares a boundary day with the selected period (overlap, not precedence)", () => {
    const overlapping = candidate({
      startsAt: new Date("2026-03-19T00:00:00Z"),
      endsAt: new Date("2026-04-01T00:00:00Z"), // same day selected.startsAt begins
    });
    expect(isEligibleComparisonPeriod(overlapping, selected)).toBe(false);
  });

  it("accepts a candidate ending one millisecond before the selected period starts, given a matching duration", () => {
    const selectedDurationMs = selected.endsAt.getTime() - selected.startsAt.getTime();
    const candidateEndsAt = new Date(selected.startsAt.getTime() - 1);
    const candidateStartsAt = new Date(candidateEndsAt.getTime() - selectedDurationMs);
    const justBefore = candidate({ startsAt: candidateStartsAt, endsAt: candidateEndsAt });
    expect(isEligibleComparisonPeriod(justBefore, selected)).toBe(true);
  });

  it("rejects a candidate with a different duration", () => {
    const shorter = candidate({
      startsAt: new Date("2026-03-25T00:00:00Z"),
      endsAt: new Date("2026-03-31T00:00:00Z"), // 6 days, not 13
    });
    expect(isEligibleComparisonPeriod(shorter, selected)).toBe(false);
  });

  it("rejects a candidate that starts after the selected period", () => {
    const after = candidate({
      startsAt: new Date("2026-05-01T00:00:00Z"),
      endsAt: new Date("2026-05-14T00:00:00Z"),
    });
    expect(isEligibleComparisonPeriod(after, selected)).toBe(false);
  });
});

describe("findEligibleComparisonPeriods", () => {
  it("filters to only eligible candidates", () => {
    const eligible = candidate({ id: "eligible" });
    const ineligible = candidate({ id: "ineligible", metricAttachedActive: false });
    const result = findEligibleComparisonPeriods([eligible, ineligible], selected);
    expect(result.map((p) => p.id)).toEqual(["eligible"]);
  });
});

describe("pickDefaultComparisonPeriod", () => {
  it("returns null for an empty list", () => {
    expect(pickDefaultComparisonPeriod([])).toBeNull();
  });

  it("picks the latest startsAt", () => {
    const older = candidate({ id: "older", startsAt: new Date("2026-02-01T00:00:00Z") });
    const newer = candidate({ id: "newer", startsAt: new Date("2026-03-18T00:00:00Z") });
    expect(pickDefaultComparisonPeriod([older, newer])?.id).toBe("newer");
  });

  it("tie-breaks equal startsAt by endsAt desc", () => {
    const shorterEnd = candidate({
      id: "shorter",
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-10T00:00:00Z"),
    });
    const longerEnd = candidate({
      id: "longer",
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-20T00:00:00Z"),
    });
    expect(pickDefaultComparisonPeriod([shorterEnd, longerEnd])?.id).toBe("longer");
  });

  it("tie-breaks equal dates by createdAt desc, then id desc", () => {
    const a = candidate({
      id: "a",
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-10T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const b = candidate({
      id: "b",
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-10T00:00:00Z"),
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    expect(pickDefaultComparisonPeriod([a, b])?.id).toBe("b");
  });
});

describe("resolveComparisonPeriodSelection", () => {
  it("returns NO_ELIGIBLE_PERIOD when there are no eligible candidates and no request", () => {
    const result = resolveComparisonPeriodSelection({
      candidates: [candidate({ metricAttachedActive: false })],
      selected,
    });
    expect(result).toEqual({ status: "NO_ELIGIBLE_PERIOD" });
  });

  it("returns NO_ELIGIBLE_PERIOD when the selected period itself lacks dates", () => {
    const result = resolveComparisonPeriodSelection({
      candidates: [candidate({})],
      selected: { startsAt: null, endsAt: null },
    });
    expect(result).toEqual({ status: "NO_ELIGIBLE_PERIOD" });
  });

  it("auto-selects the recommended default when no periodId is requested", () => {
    const result = resolveComparisonPeriodSelection({
      candidates: [candidate({ id: "p1", name: "Period 1" })],
      selected,
    });
    expect(result).toEqual({
      status: "RESOLVED",
      period: { id: "p1", name: "Period 1" },
      eligiblePeriods: [{ id: "p1", name: "Period 1" }],
    });
  });

  it("uses the explicitly requested period when it is eligible", () => {
    const p1 = candidate({ id: "p1", name: "Period 1" });
    const p2 = candidate({
      id: "p2",
      name: "Period 2",
      startsAt: new Date("2026-02-01T00:00:00Z"),
      endsAt: new Date("2026-02-14T00:00:00Z"),
    });
    const result = resolveComparisonPeriodSelection({
      requestedPeriodId: "p2",
      candidates: [p1, p2],
      selected,
    });
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.period.id).toBe("p2");
    }
  });

  it("never silently substitutes an explicit but ineligible request — returns INVALID_COMPARISON_PERIOD with a recommendation", () => {
    const eligible = candidate({ id: "p1", name: "Period 1" });
    const result = resolveComparisonPeriodSelection({
      requestedPeriodId: "does-not-exist",
      candidates: [eligible],
      selected,
    });
    expect(result).toEqual({
      status: "INVALID_COMPARISON_PERIOD",
      requestedPeriodId: "does-not-exist",
      recommended: { id: "p1", name: "Period 1" },
      eligiblePeriods: [{ id: "p1", name: "Period 1" }],
    });
  });

  it("returns INVALID_COMPARISON_PERIOD with a null recommendation when nothing is eligible", () => {
    const result = resolveComparisonPeriodSelection({
      requestedPeriodId: "does-not-exist",
      candidates: [candidate({ metricAttachedActive: false })],
      selected,
    });
    expect(result).toEqual({
      status: "INVALID_COMPARISON_PERIOD",
      requestedPeriodId: "does-not-exist",
      recommended: null,
      eligiblePeriods: [],
    });
  });
});
