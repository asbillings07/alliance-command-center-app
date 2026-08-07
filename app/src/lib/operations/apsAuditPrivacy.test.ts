import { describe, expect, it } from "vitest";
import {
  MIN_CELL_SIZE,
  assignPseudonymousAllianceLabels,
  assignPseudonymousMetricLabels,
  coarsenCorrelatedCounts,
  coarsenSmallCount,
  formatSuppressibleStatistic,
  suppressCorrelatedCounts,
  suppressSmallCell,
} from "./apsAuditPrivacy";

describe("assignPseudonymousAllianceLabels", () => {
  it("labels alliances A, B, C... sorted by id, not by input order", () => {
    const labels = assignPseudonymousAllianceLabels(["c-id", "a-id", "b-id"]);
    expect(labels.get("a-id")).toBe("Alliance A");
    expect(labels.get("b-id")).toBe("Alliance B");
    expect(labels.get("c-id")).toBe("Alliance C");
  });

  it("is deterministic regardless of input order", () => {
    const labelsOne = assignPseudonymousAllianceLabels(["z", "a", "m"]);
    const labelsTwo = assignPseudonymousAllianceLabels(["m", "z", "a"]);
    expect([...labelsOne.entries()].sort()).toEqual([...labelsTwo.entries()].sort());
  });

  it("extends past Z without collisions (AA, AB, ...)", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${String(i).padStart(2, "0")}`);
    const labels = assignPseudonymousAllianceLabels(ids);
    const values = new Set(labels.values());
    expect(values.size).toBe(30);
    expect(labels.get("id-00")).toBe("Alliance A");
    expect(labels.get("id-25")).toBe("Alliance Z");
    expect(labels.get("id-26")).toBe("Alliance AA");
  });
});

describe("assignPseudonymousMetricLabels", () => {
  it("labels metrics 'Metric 1', 'Metric 2', ... sorted by id", () => {
    const labels = assignPseudonymousMetricLabels(["metric-b", "metric-a"]);
    expect(labels.get("metric-a")).toBe("Metric 1");
    expect(labels.get("metric-b")).toBe("Metric 2");
  });
});

describe("suppressSmallCell", () => {
  it("suppresses when cell size is below the minimum", () => {
    const result = suppressSmallCell(MIN_CELL_SIZE - 1, 42);
    expect(result).toEqual({ suppressed: true, cellSize: MIN_CELL_SIZE - 1, minCellSize: MIN_CELL_SIZE });
  });

  it("does not suppress when cell size meets the minimum", () => {
    const result = suppressSmallCell(MIN_CELL_SIZE, 42);
    expect(result).toEqual({ suppressed: false, value: 42 });
  });

  it("supports a custom minimum threshold", () => {
    expect(suppressSmallCell(2, "x", 3)).toEqual({ suppressed: true, cellSize: 2, minCellSize: 3 });
    expect(suppressSmallCell(3, "x", 3)).toEqual({ suppressed: false, value: "x" });
  });
});

describe("suppressCorrelatedCounts", () => {
  it("does not suppress when every count is either 0 or at/above the minimum", () => {
    const result = suppressCorrelatedCounts([0, 5, 20, 0], "value");
    expect(result).toEqual({ suppressed: false, value: "value" });
  });

  it("suppresses the whole bundle when any single count is a small positive number", () => {
    // This is the case a naive per-field suppression misses: 5 and 20 are
    // each individually "safe," but the correlated total is 25 = 5+20 --
    // if a bundle mate is small (1), showing the other two lets the small
    // one be reconstructed by subtraction, so the WHOLE bundle suppresses.
    const result = suppressCorrelatedCounts([1, 5, 20], "value");
    expect(result).toEqual({ suppressed: true, cellSize: 1, minCellSize: MIN_CELL_SIZE });
  });

  it("does not treat an exact 0 as risky on its own", () => {
    // 0 missing / 0 invalid (perfect coverage) must not suppress an
    // otherwise-healthy, large-cohort row.
    const result = suppressCorrelatedCounts([0, 0, 50], "value");
    expect(result).toEqual({ suppressed: false, value: "value" });
  });

  it("reports the smallest risky count as the cell size when multiple are risky", () => {
    const result = suppressCorrelatedCounts([3, 1, 20], "value");
    expect(result.suppressed).toBe(true);
    if (result.suppressed) {
      expect(result.cellSize).toBe(1);
    }
  });

  it("supports a custom minimum threshold", () => {
    expect(suppressCorrelatedCounts([2], "x", 3)).toEqual({ suppressed: true, cellSize: 2, minCellSize: 3 });
    expect(suppressCorrelatedCounts([3], "x", 3)).toEqual({ suppressed: false, value: "x" });
  });
});

describe("coarsenSmallCount", () => {
  it("renders 0 exactly", () => {
    expect(coarsenSmallCount(0)).toBe("0");
  });

  it.each([1, 2, 3, 4])("renders a small positive count (%i) as a coarse range, not the exact number", (n) => {
    const result = coarsenSmallCount(n);
    expect(result).toBe(`1-${MIN_CELL_SIZE - 1}`);
    expect(result).not.toBe(String(n));
  });

  it("renders a count at or above MIN_CELL_SIZE exactly", () => {
    expect(coarsenSmallCount(MIN_CELL_SIZE)).toBe(String(MIN_CELL_SIZE));
    expect(coarsenSmallCount(50)).toBe("50");
  });

  it("supports a custom minimum threshold", () => {
    expect(coarsenSmallCount(2, 3)).toBe("1-2");
    expect(coarsenSmallCount(3, 3)).toBe("3");
  });
});

describe("coarsenCorrelatedCounts", () => {
  it("renders every count in the bundle exactly when all are 0 or >= minCellSize", () => {
    const result = coarsenCorrelatedCounts({ total: 20, active: 15, archived: 5 });
    expect(result).toEqual({ total: "20", active: "15", archived: "5" });
  });

  it("renders every count in the bundle exactly when all are 0", () => {
    const result = coarsenCorrelatedCounts({ total: 0, active: 0, archived: 0 });
    expect(result).toEqual({ total: "0", active: "0", archived: "0" });
  });

  it("suppresses EVERY count in the bundle -- not just the risky one -- once any is small and positive", () => {
    // This is the specific gap independent coarsening can't close: if only
    // `archived` were coarsened here, `total - active` would still recover
    // it exactly.
    const result = coarsenCorrelatedCounts({ total: 20, active: 18, archived: 2 });
    expect(result.total).toBe(`suppressed (cell size < ${MIN_CELL_SIZE})`);
    expect(result.active).toBe(`suppressed (cell size < ${MIN_CELL_SIZE})`);
    expect(result.archived).toBe(`suppressed (cell size < ${MIN_CELL_SIZE})`);
  });

  it("never discloses the exact triggering cell size in the suppression marker", () => {
    const result = coarsenCorrelatedCounts({ a: 1, b: 100 });
    expect(result.a).not.toMatch(/cell size 1\b/);
    expect(result.b).not.toMatch(/cell size 1\b/);
  });

  it("supports a custom minimum threshold", () => {
    expect(coarsenCorrelatedCounts({ a: 2, b: 10 }, { minCellSize: 3 })).toEqual({
      a: "suppressed (cell size < 3)",
      b: "suppressed (cell size < 3)",
    });
    expect(coarsenCorrelatedCounts({ a: 3, b: 10 }, { minCellSize: 3 })).toEqual({ a: "3", b: "10" });
  });

  // -------------------------------------------------------------------
  // additionalRiskValues: an implicit complement (total minus a shown
  // subset) that is never itself a rendered field must still gate the
  // whole bundle when it's small (review regression #1).
  // -------------------------------------------------------------------

  it("suppresses the whole bundle when a declared additionalRiskValues complement is small, even though every rendered value is individually safe", () => {
    // total=20/enough=19 -> the implicit "not enough" complement is 1,
    // even though neither `total` nor `enough` is itself small.
    const result = coarsenCorrelatedCounts({ total: 20, enough: 19 }, { additionalRiskValues: [20 - 19] });
    expect(result.total).toBe(`suppressed (cell size < ${MIN_CELL_SIZE})`);
    expect(result.enough).toBe(`suppressed (cell size < ${MIN_CELL_SIZE})`);
  });

  it("does not suppress when a declared additionalRiskValues complement also clears minCellSize", () => {
    const result = coarsenCorrelatedCounts({ total: 20, enough: 10 }, { additionalRiskValues: [20 - 10] });
    expect(result).toEqual({ total: "20", enough: "10" });
  });

  it("treats a zero additionalRiskValues complement as safe (an exact match discloses no small subgroup)", () => {
    const result = coarsenCorrelatedCounts({ total: 20, enough: 20 }, { additionalRiskValues: [20 - 20] });
    expect(result).toEqual({ total: "20", enough: "20" });
  });

  it("treats an additionalRiskValues complement of exactly minCellSize as safe, matching the single-value boundary", () => {
    const result = coarsenCorrelatedCounts({ total: 20, enough: 15 }, { additionalRiskValues: [20 - 15] });
    expect(result).toEqual({ total: "20", enough: "15" });
  });

  // -------------------------------------------------------------------
  // Genuinely UNRELATED counts that merely happen to be numerically close
  // must NOT be suppressed -- flagging them would erase valid evidence
  // and mislabel it as suppressed for a reason that doesn't apply (review
  // regression #2, pushing back on the earlier blanket pairwise-diff
  // approach).
  // -------------------------------------------------------------------

  it("does NOT suppress two unrelated, individually-safe counts merely because they are numerically close (active=11/inactive=9 attachments)", () => {
    const result = coarsenCorrelatedCounts({ active: 11, inactive: 9 });
    expect(result).toEqual({ active: "11", inactive: "9" });
  });

  it("does NOT suppress two unrelated, individually-safe counts in different units merely because they are numerically close (periods=20/pairs=19)", () => {
    const result = coarsenCorrelatedCounts({ periods: 20, pairs: 19 });
    expect(result).toEqual({ periods: "20", pairs: "19" });
  });

  it("does NOT suppress metric stability counts (added=11/removed=9) that have no total/subset relationship to each other", () => {
    const result = coarsenCorrelatedCounts({ added: 11, removed: 9 });
    expect(result).toEqual({ added: "11", removed: "9" });
  });
});

describe("formatSuppressibleStatistic", () => {
  it("formats a suppressed statistic without leaking the underlying value or the exact suppressed cell size", () => {
    const result = formatSuppressibleStatistic({ suppressed: true, cellSize: 2, minCellSize: 5 }, (v) => String(v));
    expect(result).toBe("suppressed (cell size < 5)");
    expect(result).not.toContain("2");
  });

  it("formats a non-suppressed statistic using the provided formatter", () => {
    const result = formatSuppressibleStatistic({ suppressed: false, value: 42 }, (v) => `value=${v}`);
    expect(result).toBe("value=42");
  });
});
