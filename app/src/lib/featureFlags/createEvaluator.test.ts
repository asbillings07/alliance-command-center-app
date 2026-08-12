import { describe, it, expect } from "vitest";
import { createEvaluator } from "./createEvaluator";
import type { FlagDecisionProvider } from "./provider";
import type { FeatureFlagDefinition } from "./registry";
import type { FeatureContext } from "./context";

/**
 * Proves alliance-targeting, wrong-context denial, and concurrency isolation
 * generically, against a test-only registry + deterministic in-memory
 * provider - never against the real (global-only) production registry, and
 * never through the real Vercel-backed provider (see provider.test.ts for
 * that boundary).
 */

type TestFlagKey = "alliance-targeted-test-flag" | "operator-only-test-flag";

const testRegistry: Record<TestFlagKey, FeatureFlagDefinition> = {
  "alliance-targeted-test-flag": {
    key: "alliance-targeted-test-flag",
    description: "test fixture",
    category: "temporary-release",
    owner: "Engineering",
    issue: "#331",
    productionDefault: false,
    targetingStrategy: "alliance-targeted",
    expiresOn: "2099-01-01",
    removalIssue: "#331",
  },
  "operator-only-test-flag": {
    key: "operator-only-test-flag",
    description: "test fixture",
    category: "operational-kill-switch",
    owner: "Engineering",
    issue: "#331",
    productionDefault: true,
    targetingStrategy: "operator-only",
    expiresOn: "2099-01-01",
    removalIssue: "#331",
  },
};

function inMemoryProvider(
  rules: Partial<Record<TestFlagKey, (context: FeatureContext) => boolean>>
): FlagDecisionProvider {
  return {
    async resolve(definition, context) {
      const rule = rules[definition.key as TestFlagKey];
      if (!rule) {
        return definition.productionDefault;
      }
      return rule(context);
    },
  };
}

describe("createEvaluator", () => {
  it("allows a targeted alliance and denies an untargeted one", async () => {
    const ALLOWED_ALLIANCE = "alliance-allowed";
    const provider = inMemoryProvider({
      "alliance-targeted-test-flag": (context) => context.alliance?.id === ALLOWED_ALLIANCE,
    });
    const evaluator = createEvaluator(testRegistry, provider);

    await expect(
      evaluator("alliance-targeted-test-flag", {
        environment: "production",
        alliance: { id: ALLOWED_ALLIANCE },
      })
    ).resolves.toBe(true);

    await expect(
      evaluator("alliance-targeted-test-flag", {
        environment: "production",
        alliance: { id: "alliance-not-targeted" },
      })
    ).resolves.toBe(false);
  });

  it("denies a wrong-cohort alliance even when alliance.id would otherwise match a broader rule", async () => {
    const provider = inMemoryProvider({
      "alliance-targeted-test-flag": (context) =>
        context.alliance?.id === "alliance-a" && context.alliance?.cohort === "founder-beta",
    });
    const evaluator = createEvaluator(testRegistry, provider);

    await expect(
      evaluator("alliance-targeted-test-flag", {
        environment: "production",
        alliance: { id: "alliance-a", cohort: "founder-beta" },
      })
    ).resolves.toBe(true);

    await expect(
      evaluator("alliance-targeted-test-flag", {
        environment: "production",
        alliance: { id: "alliance-a", cohort: "general" },
      })
    ).resolves.toBe(false);
  });

  it("allows a targeted platform operator and denies a non-operator user", async () => {
    const provider = inMemoryProvider({
      "operator-only-test-flag": (context) => context.isPlatformAdmin === true,
    });
    const evaluator = createEvaluator(testRegistry, provider);

    await expect(
      evaluator("operator-only-test-flag", {
        environment: "production",
        userId: "user-1",
        isPlatformAdmin: true,
      })
    ).resolves.toBe(true);

    await expect(
      evaluator("operator-only-test-flag", {
        environment: "production",
        userId: "user-2",
        isPlatformAdmin: false,
      })
    ).resolves.toBe(false);
  });

  it("re-evaluates independently across two sequential calls, honoring a flag-flip between them", async () => {
    let enabled = false;
    const provider: FlagDecisionProvider = {
      async resolve() {
        return enabled;
      },
    };
    const evaluator = createEvaluator(testRegistry, provider);
    const context: FeatureContext = { environment: "production", alliance: { id: "alliance-a" } };

    await expect(evaluator("alliance-targeted-test-flag", context)).resolves.toBe(false);
    enabled = true;
    await expect(evaluator("alliance-targeted-test-flag", context)).resolves.toBe(true);
  });

  it("proves concurrency isolation: two interleaved calls for different alliances never leak into each other", async () => {
    const ALLOWED_ALLIANCE = "alliance-allowed";
    const provider = inMemoryProvider({
      "alliance-targeted-test-flag": (context) => context.alliance?.id === ALLOWED_ALLIANCE,
    });
    const evaluator = createEvaluator(testRegistry, provider);

    const contexts: FeatureContext[] = Array.from({ length: 20 }, (_, i) => ({
      environment: "production",
      alliance: { id: i % 2 === 0 ? ALLOWED_ALLIANCE : `alliance-other-${i}` },
    }));

    const results = await Promise.all(
      contexts.map((context) => evaluator("alliance-targeted-test-flag", context))
    );

    results.forEach((result, i) => {
      expect(result).toBe(i % 2 === 0);
    });
  });

  it("never mutates or reads module-level state - each call receives only its own explicit context", async () => {
    const receivedContexts: FeatureContext[] = [];
    const provider: FlagDecisionProvider = {
      async resolve(_definition, context) {
        receivedContexts.push(context);
        return true;
      },
    };
    const evaluator = createEvaluator(testRegistry, provider);

    const contextA: FeatureContext = { environment: "production", alliance: { id: "alliance-a" } };
    const contextB: FeatureContext = { environment: "production", alliance: { id: "alliance-b" } };
    await Promise.all([
      evaluator("alliance-targeted-test-flag", contextA),
      evaluator("alliance-targeted-test-flag", contextB),
    ]);

    expect(receivedContexts).toHaveLength(2);
    expect(receivedContexts).toContainEqual(contextA);
    expect(receivedContexts).toContainEqual(contextB);
  });
});
