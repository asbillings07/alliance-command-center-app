import { describe, it, expect } from "vitest";
import { formatMetricValue } from "./formatMetricValue";

describe("formatMetricValue", () => {
  it("compacts large values via formatPower", () => {
    expect(formatMetricValue(1_000_000).compact).toBe("1M");
  });

  it("leaves small values as plain numbers", () => {
    expect(formatMetricValue(850).compact).toBe("850");
  });

  it("appends the unit label to the compact display when provided", () => {
    expect(formatMetricValue(45_200_000, "pts").compact).toBe("45.2M pts");
  });

  it("omits the unit label entirely when not provided", () => {
    expect(formatMetricValue(850).compact).not.toContain("undefined");
    expect(formatMetricValue(850, null).compact).toBe("850");
  });

  it("always includes the exact locale-formatted value, distinguishing visually-compacted neighbors", () => {
    expect(formatMetricValue(999_950).compact).toBe("1M");
    expect(formatMetricValue(999_950).exact).toBe("999,950");
    expect(formatMetricValue(1_000_000).compact).toBe("1M");
    expect(formatMetricValue(1_000_000).exact).toBe("1,000,000");
  });

  it("handles negative values", () => {
    const result = formatMetricValue(-1_500_000, "pts");
    expect(result.compact).toBe("-1.5M pts");
    expect(result.exact).toBe("-1,500,000");
  });
});
