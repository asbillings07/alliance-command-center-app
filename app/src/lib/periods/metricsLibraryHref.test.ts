import { describe, it, expect } from "vitest";
import { buildMetricsLibraryHref } from "./metricsLibraryHref";

describe("buildMetricsLibraryHref", () => {
  it("builds a metrics library URL with encoded returnTo for the period", () => {
    expect(buildMetricsLibraryHref("all_1", "per_1")).toBe(
      "/alliances/all_1/metrics?returnTo=%2Falliances%2Fall_1%2Fperiods%2Fper_1",
    );
  });
});
