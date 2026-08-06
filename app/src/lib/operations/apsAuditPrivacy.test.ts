import { describe, expect, it } from "vitest";
import {
  MIN_CELL_SIZE,
  assignPseudonymousAllianceLabels,
  assignPseudonymousMetricLabels,
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
