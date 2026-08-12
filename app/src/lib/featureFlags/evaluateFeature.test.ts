import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const decideMock = vi.fn();

vi.mock("@flags-sdk/vercel", () => ({
  vercelAdapter: () => ({ decide: decideMock }),
}));

describe("evaluateFeature", () => {
  beforeEach(() => {
    vi.resetModules();
    decideMock.mockReset();
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
});
