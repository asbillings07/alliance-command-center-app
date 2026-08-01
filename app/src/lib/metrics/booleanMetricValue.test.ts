import { describe, it, expect } from "vitest";
import { isValidBooleanMetricValue } from "./booleanMetricValue";

describe("isValidBooleanMetricValue", () => {
  it("accepts exactly 0", () => {
    expect(isValidBooleanMetricValue(0)).toBe(true);
  });

  it("accepts exactly 1", () => {
    expect(isValidBooleanMetricValue(1)).toBe(true);
  });

  it.each([-1, 2, 42, 0.5, 1.0001, -0.5, NaN, Infinity, -Infinity])(
    "rejects %s",
    (value) => {
      expect(isValidBooleanMetricValue(value)).toBe(false);
    },
  );
});
