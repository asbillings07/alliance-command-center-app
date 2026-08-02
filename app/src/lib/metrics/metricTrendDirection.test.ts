import { describe, it, expect } from "vitest";
import { MetricTrendDirection } from "@/app/generated/prisma/enums";
import { isAdverseComparisonChange } from "./metricTrendDirection";

describe("isAdverseComparisonChange", () => {
  it("is never adverse for NEUTRAL, regardless of which way the number moves", () => {
    expect(isAdverseComparisonChange(MetricTrendDirection.NEUTRAL, -100)).toBe(false);
    expect(isAdverseComparisonChange(MetricTrendDirection.NEUTRAL, 100)).toBe(false);
    expect(isAdverseComparisonChange(MetricTrendDirection.NEUTRAL, 0)).toBe(false);
  });

  it("flags a decrease as adverse for HIGHER_IS_BETTER", () => {
    expect(isAdverseComparisonChange(MetricTrendDirection.HIGHER_IS_BETTER, -1)).toBe(true);
  });

  it("does not flag an increase or no change as adverse for HIGHER_IS_BETTER", () => {
    expect(isAdverseComparisonChange(MetricTrendDirection.HIGHER_IS_BETTER, 1)).toBe(false);
    expect(isAdverseComparisonChange(MetricTrendDirection.HIGHER_IS_BETTER, 0)).toBe(false);
  });

  it("flags an increase as adverse for LOWER_IS_BETTER", () => {
    expect(isAdverseComparisonChange(MetricTrendDirection.LOWER_IS_BETTER, 1)).toBe(true);
  });

  it("does not flag a decrease or no change as adverse for LOWER_IS_BETTER", () => {
    expect(isAdverseComparisonChange(MetricTrendDirection.LOWER_IS_BETTER, -1)).toBe(false);
    expect(isAdverseComparisonChange(MetricTrendDirection.LOWER_IS_BETTER, 0)).toBe(false);
  });
});
