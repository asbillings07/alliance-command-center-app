import { describe, it, expect } from "vitest";
import { formatMetricAverage } from "./formatMetricAverage";

describe("formatMetricAverage", () => {
  it("renders a whole number without decimals", () => {
    expect(formatMetricAverage(42)).toBe("42");
  });

  it("renders one decimal place for a simple fraction", () => {
    expect(formatMetricAverage(42.5)).toBe("42.5");
  });

  it("rounds to at most two decimal places", () => {
    expect(formatMetricAverage(42.567)).toBe("42.57");
  });

  it("does not compact large averages through K/M/G/T suffixes", () => {
    expect(formatMetricAverage(1_500_000.25)).toBe("1,500,000.25");
  });

  it("appends the unit label when provided", () => {
    expect(formatMetricAverage(3.4, "donations")).toBe("3.4 donations");
  });

  it("omits the unit label when not provided", () => {
    expect(formatMetricAverage(3.4, null)).toBe("3.4");
  });

  it("preserves the sign for negative differences from average", () => {
    expect(formatMetricAverage(-5.25)).toBe("-5.25");
  });

  it("renders zero as a whole number", () => {
    expect(formatMetricAverage(0)).toBe("0");
  });

  it("rounds a negative half-tie away from zero, symmetric with its positive counterpart", () => {
    // Plain Math.round(-4256.5) === -4256 (rounds toward zero), while
    // Math.round(4256.5) === 4257 (rounds away from zero) — an
    // equal-magnitude positive and negative average must round to the same
    // magnitude.
    expect(formatMetricAverage(42.565)).toBe("42.57");
    expect(formatMetricAverage(-42.565)).toBe("-42.57");
  });
});
