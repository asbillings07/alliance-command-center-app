import { describe, it, expect } from "vitest";
import { formatPercent } from "./formatPercent";

describe("formatPercent", () => {
  it("renders a percentage with a trailing % by default", () => {
    expect(formatPercent(42.3)).toBe("42.3%");
  });

  it("renders a whole-number percentage without decimals", () => {
    expect(formatPercent(50)).toBe("50%");
  });

  it("rounds to one decimal place", () => {
    expect(formatPercent(42.567)).toBe("42.6%");
  });

  it("renders a percentage-point change with a trailing pp", () => {
    expect(formatPercent(3.5, { unit: "pp" })).toBe("3.5pp");
  });

  it("never appends a unitLabel-like suffix beyond % or pp", () => {
    const result = formatPercent(10);
    expect(result).toBe("10%");
    expect(result).not.toMatch(/pts|donations/);
  });

  it("prefixes a positive signed change with +", () => {
    expect(formatPercent(12.3, { signed: true })).toBe("+12.3%");
  });

  it("does not double up the sign for a negative signed change", () => {
    expect(formatPercent(-4.5, { signed: true })).toBe("-4.5%");
  });

  it("does not prefix zero with + even when signed", () => {
    expect(formatPercent(0, { signed: true })).toBe("0%");
  });

  it("renders an unsigned negative value with its native minus sign", () => {
    expect(formatPercent(-4.5)).toBe("-4.5%");
  });

  it("combines signed with the pp unit for a true-rate point change", () => {
    expect(formatPercent(-2.1, { unit: "pp", signed: true })).toBe("-2.1pp");
  });

  it("rounds a negative half-tie away from zero, symmetric with its positive counterpart", () => {
    // Plain Math.round(-45.5) === -45 (rounds toward zero), while
    // Math.round(45.5) === 46 (rounds away from zero) — an equal-magnitude
    // gain and loss must render with the same magnitude.
    expect(formatPercent(4.55)).toBe("4.6%");
    expect(formatPercent(-4.55)).toBe("-4.6%");
  });
});
