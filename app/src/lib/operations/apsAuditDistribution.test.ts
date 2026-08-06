import { describe, expect, it } from "vitest";
import { computeNumericDistribution } from "./apsAuditDistribution";

describe("computeNumericDistribution", () => {
  it("returns null for an empty array", () => {
    expect(computeNumericDistribution([])).toBeNull();
  });

  it("computes min/max/percentiles for a simple ascending set", () => {
    const distribution = computeNumericDistribution([1, 2, 3, 4, 5]);
    expect(distribution).toMatchObject({ count: 5, min: 1, max: 5, p50: 3 });
  });

  it("is order-independent", () => {
    const a = computeNumericDistribution([5, 1, 3, 2, 4]);
    const b = computeNumericDistribution([1, 2, 3, 4, 5]);
    expect(a).toEqual(b);
  });

  it("counts zeros and negatives", () => {
    const distribution = computeNumericDistribution([-5, 0, 0, 3, 10]);
    expect(distribution?.zeroCount).toBe(2);
    expect(distribution?.negativeCount).toBe(1);
  });

  it("flags values outside the Tukey fence as outliers", () => {
    // Tight cluster plus one clear outlier.
    const distribution = computeNumericDistribution([10, 11, 12, 11, 10, 12, 11, 1000]);
    expect(distribution?.outlierCount).toBe(1);
  });

  it("reports zero outliers for a uniform set", () => {
    const distribution = computeNumericDistribution([5, 5, 5, 5, 5]);
    expect(distribution?.outlierCount).toBe(0);
  });

  it("handles a single value", () => {
    const distribution = computeNumericDistribution([42]);
    expect(distribution).toMatchObject({ count: 1, min: 42, max: 42, p25: 42, p50: 42, p75: 42, outlierCount: 0 });
  });

  it("handles negative-only sparse data (sparse period edge case)", () => {
    const distribution = computeNumericDistribution([-1, -2]);
    expect(distribution?.negativeCount).toBe(2);
    expect(distribution?.count).toBe(2);
  });
});
