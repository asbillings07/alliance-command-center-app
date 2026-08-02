import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("features — reports flag (#190)", () => {
  const originalValue = process.env.FEATURE_REPORTS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.FEATURE_REPORTS;
    } else {
      process.env.FEATURE_REPORTS = originalValue;
    }
    vi.resetModules();
  });

  it("ships dark by default: reports is disabled when FEATURE_REPORTS is unset", async () => {
    delete process.env.FEATURE_REPORTS;
    const { isFeatureEnabled } = await import("./features");
    expect(isFeatureEnabled("reports")).toBe(false);
  });

  it("is disabled for any value other than the literal string 'true'", async () => {
    process.env.FEATURE_REPORTS = "1";
    const { isFeatureEnabled } = await import("./features");
    expect(isFeatureEnabled("reports")).toBe(false);
  });

  it("is enabled once FEATURE_REPORTS is explicitly set to 'true'", async () => {
    process.env.FEATURE_REPORTS = "true";
    const { isFeatureEnabled } = await import("./features");
    expect(isFeatureEnabled("reports")).toBe(true);
  });

  it("is included in getEnabledFeatures() once turned on", async () => {
    process.env.FEATURE_REPORTS = "true";
    const { getEnabledFeatures } = await import("./features");
    expect(getEnabledFeatures()).toContain("reports");
  });
});
