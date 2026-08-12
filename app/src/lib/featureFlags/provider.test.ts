import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FeatureFlagDefinition } from "./registry";

/**
 * Proves the real `vercelDecisionProvider` implementation - not the
 * deterministic in-memory test seam (`createEvaluator.test.ts`) - forwards
 * per-call trusted context through the Flags SDK correctly. Only the
 * network-calling Vercel adapter is faked; everything else (the `flag()`
 * declaration, `.run()` wiring, defaultValue fallback) is the real
 * production code path.
 */
const decideMock = vi.fn();

vi.mock("@flags-sdk/vercel", () => ({
  vercelAdapter: () => ({ decide: decideMock }),
}));

const definition: FeatureFlagDefinition = {
  key: "reports",
  description: "test flag",
  category: "temporary-release",
  owner: "Engineering",
  issue: "#190",
  productionDefault: false,
  targetingStrategy: "global",
  expiresOn: "2099-01-01",
  removalIssue: "#336",
};

describe("vercelDecisionProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    decideMock.mockReset();
  });

  it("forwards the exact FeatureContext passed for a single call", async () => {
    decideMock.mockImplementation(({ entities }) => entities?.alliance?.id === "alliance-a");
    const { vercelDecisionProvider } = await import("./provider");

    const result = await vercelDecisionProvider.resolve(definition, {
      environment: "production",
      alliance: { id: "alliance-a" },
    });

    expect(result).toBe(true);
    expect(decideMock).toHaveBeenCalledTimes(1);
    const call = decideMock.mock.calls[0]![0];
    expect(call.entities).toEqual({
      alliance: { id: "alliance-a" },
      user: { id: undefined, isPlatformAdmin: undefined },
    });
  });

  it("keeps concurrent, different-alliance contexts distinct end to end", async () => {
    decideMock.mockImplementation(({ entities }) => entities?.alliance?.id === "alliance-a");
    const { vercelDecisionProvider } = await import("./provider");

    const [resultA, resultB] = await Promise.all([
      vercelDecisionProvider.resolve(definition, {
        environment: "production",
        alliance: { id: "alliance-a" },
      }),
      vercelDecisionProvider.resolve(definition, {
        environment: "production",
        alliance: { id: "alliance-b" },
      }),
    ]);

    expect(resultA).toBe(true);
    expect(resultB).toBe(false);
  });

  it("never relies on an ambient identify/headers/cookies path - decide only ever sees the entities we pass explicitly", async () => {
    // The provider deliberately declares no `identify` function on the flag
    // itself, so there is no code path through which `decide` could receive
    // anything other than the entities this call explicitly supplied - this
    // asserts that invariant by checking every recorded call's entities
    // match exactly one of the two calls made below, never a merge of both
    // or a third, ambient value.
    decideMock.mockReturnValue(true);
    const { vercelDecisionProvider } = await import("./provider");

    await vercelDecisionProvider.resolve(definition, {
      environment: "production",
      alliance: { id: "alliance-a" },
      userId: "user-1",
    });
    await vercelDecisionProvider.resolve(definition, { environment: "production" });

    expect(decideMock).toHaveBeenCalledTimes(2);
    expect(decideMock.mock.calls[0]![0].entities).toEqual({
      alliance: { id: "alliance-a" },
      user: { id: "user-1", isPlatformAdmin: undefined },
    });
    expect(decideMock.mock.calls[1]![0].entities).toEqual({
      alliance: undefined,
      user: { id: undefined, isPlatformAdmin: undefined },
    });
  });

  it("models operator-only targeting as a `user.isPlatformAdmin` attribute, not a separate top-level entity - the exact `identify` payload Slice A's operator-only targeting strategy depends on", async () => {
    decideMock.mockImplementation(({ entities }) => entities?.user?.isPlatformAdmin === true);
    const { vercelDecisionProvider } = await import("./provider");

    const result = await vercelDecisionProvider.resolve(definition, {
      environment: "production",
      userId: "user-1",
      isPlatformAdmin: true,
    });

    expect(result).toBe(true);
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(decideMock.mock.calls[0]![0].entities).toEqual({
      alliance: undefined,
      user: { id: "user-1", isPlatformAdmin: true },
    });
  });

  it("falls back to the registry's productionDefault when the adapter throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    decideMock.mockImplementation(() => {
      throw new Error("simulated adapter failure");
    });
    const { vercelDecisionProvider } = await import("./provider");

    const result = await vercelDecisionProvider.resolve(definition, { environment: "production" });

    expect(result).toBe(definition.productionDefault);
    warnSpy.mockRestore();
  });
});
