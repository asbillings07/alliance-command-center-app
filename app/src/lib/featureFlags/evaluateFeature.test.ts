import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const decideMock = vi.fn();
const addBreadcrumbMock = vi.fn();

vi.mock("@flags-sdk/vercel", () => ({
  vercelAdapter: () => ({ decide: decideMock }),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: addBreadcrumbMock,
}));

describe("evaluateFeature", () => {
  beforeEach(() => {
    vi.resetModules();
    decideMock.mockReset();
    addBreadcrumbMock.mockReset();
    vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("ACC_E2E_MODE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves via the real provider when no test override is configured", async () => {
    decideMock.mockReturnValue(true);
    const { evaluateFeature } = await import("./evaluateFeature");

    await expect(evaluateFeature("reports", { environment: "production" })).resolves.toBe(true);
    expect(decideMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the registry default (false) when the provider is unconfigured/fails", async () => {
    decideMock.mockImplementation(() => {
      throw new Error("no FLAGS configured");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { evaluateFeature } = await import("./evaluateFeature");

    await expect(evaluateFeature("reports", { environment: "production" })).resolves.toBe(false);
    warnSpy.mockRestore();
  });

  it("test override short-circuits the real provider entirely when active", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"reports":true}');
    const { evaluateFeature } = await import("./evaluateFeature");

    await expect(evaluateFeature("reports", { environment: "development" })).resolves.toBe(true);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("propagates the activation-boundary error rather than silently falling through", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"reports":true}');
    const { evaluateFeature } = await import("./evaluateFeature");

    await expect(evaluateFeature("reports", { environment: "production" })).rejects.toThrow(
      /Vercel-managed environment/
    );
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("re-evaluates independently across two calls (simulating two execution boundaries) with a flag-flip between them", async () => {
    decideMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { evaluateFeature } = await import("./evaluateFeature");

    await expect(evaluateFeature("reports", { environment: "production" })).resolves.toBe(false);
    await expect(evaluateFeature("reports", { environment: "production" })).resolves.toBe(true);
    expect(decideMock).toHaveBeenCalledTimes(2);
  });

  describe("observability (#333)", () => {
    it("records a breadcrumb with only the flag key and resolved result", async () => {
      decideMock.mockReturnValue(true);
      const { evaluateFeature } = await import("./evaluateFeature");

      await evaluateFeature("reports", { environment: "production" });

      expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
      expect(addBreadcrumbMock).toHaveBeenCalledWith({
        category: "feature-flag",
        message: "reports",
        data: { result: true },
      });
    });

    it("never includes any FeatureContext field in the breadcrumb, even when every field is set", async () => {
      decideMock.mockReturnValue(false);
      const { evaluateFeature } = await import("./evaluateFeature");

      await evaluateFeature("reports", {
        environment: "production",
        alliance: { id: "alliance_secret_123", cohort: "founder-beta" },
        userId: "user_secret_456",
        isPlatformAdmin: true,
      });

      expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
      const [call] = addBreadcrumbMock.mock.calls;
      const serialized = JSON.stringify(call[0]);
      expect(serialized).not.toContain("alliance_secret_123");
      expect(serialized).not.toContain("founder-beta");
      expect(serialized).not.toContain("user_secret_456");
      expect(call[0]).toEqual({
        category: "feature-flag",
        message: "reports",
        data: { result: false },
      });
    });

    it("records a breadcrumb for a test-override result too", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"reports":true}');
      const { evaluateFeature } = await import("./evaluateFeature");

      await evaluateFeature("reports", { environment: "development" });

      expect(addBreadcrumbMock).toHaveBeenCalledWith({
        category: "feature-flag",
        message: "reports",
        data: { result: true },
      });
    });
  });
});
