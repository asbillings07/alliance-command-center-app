import { describe, it, expect } from "vitest";
import { deriveMemberPeriodMetricProvenance } from "./memberPeriodMetricValues";

// ADR-018 §5's provenance table, verified independently of the database -
// provenance is a pure, static function of configuration.
describe("deriveMemberPeriodMetricProvenance", () => {
  it("labels a PERIOD_VALUE metric as a source value regardless of its (unreachable in practice) rollup kind", () => {
    expect(deriveMemberPeriodMetricProvenance("PERIOD_VALUE", "LATEST")).toBe(
      "Source period value",
    );
  });

  it("labels a DAILY_OBSERVATION + LATEST metric as a derived latest observation", () => {
    expect(deriveMemberPeriodMetricProvenance("DAILY_OBSERVATION", "LATEST")).toBe(
      "Derived (latest observation)",
    );
  });

  it("labels a DAILY_OBSERVATION + SUM metric as a derived sum, even with only one contributing observation", () => {
    // The label must never be inferred from how many observations happen to
    // exist - a single-observation SUM metric is still derived, not
    // reclassified as a source value.
    expect(deriveMemberPeriodMetricProvenance("DAILY_OBSERVATION", "SUM")).toBe(
      "Derived (sum)",
    );
  });

  it("labels a DAILY_OBSERVATION + AVERAGE metric as a derived average", () => {
    expect(deriveMemberPeriodMetricProvenance("DAILY_OBSERVATION", "AVERAGE")).toBe(
      "Derived (average)",
    );
  });
});
