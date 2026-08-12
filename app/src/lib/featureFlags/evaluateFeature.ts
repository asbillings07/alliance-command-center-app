import "server-only";
import { featureFlagRegistry, type FeatureFlagKey } from "./registry";
import type { FeatureContext } from "./context";
import { vercelDecisionProvider } from "./provider";
import { createEvaluator } from "./createEvaluator";
import { resolveTestOverride } from "./testOverrides";

const registryKeys = Object.keys(featureFlagRegistry) as FeatureFlagKey[];

const productionEvaluator = createEvaluator(featureFlagRegistry, vercelDecisionProvider);

/**
 * ACC's single typed entry point for feature-flag evaluation (ADR-019 §9).
 *
 * This is the only export pages, server actions, and background jobs ever
 * import from `featureFlags/` - it has no parameter to select or inject a
 * registry or decision provider, which is what makes "production consumers
 * cannot select or inject a provider" a structural guarantee rather than a
 * convention (see `createEvaluator.ts`).
 *
 * `context` must be built from ACC's canonical authorization/tenant resolver
 * (`toFeatureContext`/`resolveEnvironment` in `./context.ts`) - never from
 * raw `params`, headers, or cookies (ADR-019 §2). Evaluates fresh on every
 * call; nothing here is safe to cache or carry across independent execution
 * boundaries (ADR-019 §3).
 *
 * Test-only environment variables (never honored in any Vercel-managed
 * environment - see `./testOverrides.ts`):
 *
 * - `FEATURE_FLAG_TEST_OVERRIDES` - a JSON object mapping flag keys to
 *   booleans, e.g. `{"reports":true}`. Bypasses the real provider entirely
 *   for the listed keys.
 * - `ACC_E2E_MODE=1` - required (alongside the override var) for a locally
 *   built-and-started app (`next start`, as Playwright drives it) to be
 *   allowed to use overrides, since that process otherwise runs with
 *   `NODE_ENV=production` and would be indistinguishable from a real
 *   production process.
 */
export async function evaluateFeature(
  flag: FeatureFlagKey,
  context: FeatureContext
): Promise<boolean> {
  const override = resolveTestOverride(flag, registryKeys, {
    featureFlagTestOverrides: process.env.FEATURE_FLAG_TEST_OVERRIDES,
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
    accE2eMode: process.env.ACC_E2E_MODE,
  });
  if (override !== undefined) {
    return override;
  }

  return productionEvaluator(flag, context);
}
