import { describe, it, expect } from "vitest";
import { roundToDecimals } from "./roundToDecimals";

describe("roundToDecimals", () => {
  it("rounds a positive half-tie away from zero", () => {
    expect(roundToDecimals(4.55, 1)).toBe(4.6);
  });

  it("rounds a negative half-tie away from zero, symmetric with its positive counterpart", () => {
    expect(roundToDecimals(-4.55, 1)).toBe(-4.6);
  });

  it("rounds down when below the half-tie", () => {
    expect(roundToDecimals(4.54, 1)).toBe(4.5);
    expect(roundToDecimals(-4.54, 1)).toBe(-4.5);
  });

  it("leaves zero as zero", () => {
    expect(roundToDecimals(0, 2)).toBe(0);
  });

  it("supports arbitrary decimal precision", () => {
    expect(roundToDecimals(1.23456, 3)).toBe(1.235);
  });
});
