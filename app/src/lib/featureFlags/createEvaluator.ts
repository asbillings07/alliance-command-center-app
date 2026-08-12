import "server-only";
import type { FeatureContext } from "./context";
import type { FeatureFlagDefinition } from "./registry";
import type { FlagDecisionProvider } from "./provider";

export type Evaluator<Key extends string> = (
  flag: Key,
  context: FeatureContext
) => Promise<boolean>;

/**
 * Internal factory building an evaluator from an explicit registry + provider
 * pair.
 *
 * This is never imported by a page, server action, or background job - only
 * by `evaluateFeature.ts` (which wires the real registry and
 * `vercelDecisionProvider`) and by test files (which wire a test-only
 * registry and a deterministic in-memory provider). That asymmetry is the
 * structural guarantee that production consumers cannot select or inject
 * either dependency: the capability simply isn't exposed by the module they
 * import (`evaluateFeature.ts`).
 *
 * `FeatureContext` is threaded through as an explicit per-call argument only
 * - nothing here is cached in module-level mutable state, so concurrent
 * calls for different alliances/users can never leak into each other.
 */
export function createEvaluator<Key extends string>(
  registry: Record<Key, FeatureFlagDefinition>,
  provider: FlagDecisionProvider
): Evaluator<Key> {
  return async (flag, context) => {
    const definition = registry[flag];
    return provider.resolve(definition, context);
  };
}
