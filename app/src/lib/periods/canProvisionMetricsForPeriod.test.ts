import { describe, it, expect } from "vitest";
import { canProvisionMetricsForPeriod } from "./canProvisionMetricsForPeriod";

describe("canProvisionMetricsForPeriod", () => {
  it("returns true when the user can configure metrics", () => {
    expect(
      canProvisionMetricsForPeriod({
        canConfigureMetrics: true,
        canConfigurePeriods: false,
        attachableLibraryMetricCount: 0,
      }),
    ).toBe(true);
  });

  it("returns true when the user can configure periods and library metrics exist", () => {
    expect(
      canProvisionMetricsForPeriod({
        canConfigureMetrics: false,
        canConfigurePeriods: true,
        attachableLibraryMetricCount: 2,
      }),
    ).toBe(true);
  });

  it("returns false when period config is allowed but no attachable library metrics exist", () => {
    expect(
      canProvisionMetricsForPeriod({
        canConfigureMetrics: false,
        canConfigurePeriods: true,
        attachableLibraryMetricCount: 0,
      }),
    ).toBe(false);
  });
});
