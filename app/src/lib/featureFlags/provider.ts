import "server-only";
import { flag as declareFlag, type Flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";
import type { FeatureContext } from "./context";
import type { FeatureFlagDefinition } from "./registry";

/**
 * The seam between a flag definition + evaluation context and a resolved
 * boolean. `vercelDecisionProvider` (below) is the only implementation
 * production code ever wires up; tests build their own deterministic
 * in-memory implementation instead (see `createEvaluator.ts`).
 */
export interface FlagDecisionProvider {
  resolve(definition: FeatureFlagDefinition, context: FeatureContext): Promise<boolean>;
}

type FlagEntities = {
  alliance?: { id: string; cohort?: string };
  user?: { id: string };
  platformAdmin?: boolean;
};

function toEntities(context: FeatureContext): FlagEntities {
  return {
    alliance: context.alliance,
    user: context.userId ? { id: context.userId } : undefined,
    platformAdmin: context.isPlatformAdmin,
  };
}

/**
 * A minimal, header/cookie-free synthetic request, rebuilt fresh on every
 * call. Passing an explicit `request` to `.run()` (below) makes the Flags SDK
 * derive its internal headers/cookies from THIS object instead of calling
 * Next.js's `headers()`/`cookies()` - which would throw outside an App
 * Router request scope (a background job, a script, or a unit test), and
 * which evaluation must not depend on anyway: trust comes only from the
 * `FeatureContext` we pass explicitly (ADR-019 §2), never from ambient
 * request state. Building a new `Request` per call (rather than one shared
 * instance) also means the SDK's internal per-request cache - keyed on this
 * object's identity - can never accumulate entries across calls in a
 * long-lived process.
 */
function syntheticRequest(): Request {
  return new Request("https://acc.internal/feature-flag-evaluation");
}

const declarations = new Map<string, Flag<boolean, FlagEntities>>();

function getDeclaration(definition: FeatureFlagDefinition): Flag<boolean, FlagEntities> {
  const existing = declarations.get(definition.key);
  if (existing) {
    return existing;
  }
  // No `identify` here, intentionally: every call site supplies its own
  // trusted FeatureContext explicitly via `.run({ identify, request })`
  // below, which bypasses any ambient identify/headers/cookies path entirely
  // - there is no fallback this provider could silently read raw request
  // state through.
  const declaration = declareFlag<boolean, FlagEntities>({
    key: definition.key,
    description: definition.description,
    defaultValue: definition.productionDefault,
    adapter: vercelAdapter(),
  });
  declarations.set(definition.key, declaration);
  return declaration;
}

/**
 * Production `FlagDecisionProvider`, backed by the Vercel Flags SDK
 * (`flags/next` + `@flags-sdk/vercel`'s `vercelAdapter()`), per ADR-019 §9.
 *
 * On an adapter failure (thrown error, or the provider's own fallback chain
 * exhausted), the Flags SDK itself falls back to the flag's declared
 * `defaultValue` - i.e. the registry's `productionDefault` - with no extra
 * handling needed here (ADR-019 §4).
 */
export const vercelDecisionProvider: FlagDecisionProvider = {
  async resolve(definition, context) {
    const declaration = getDeclaration(definition);
    return declaration.run({
      identify: toEntities(context),
      request: syntheticRequest(),
    });
  },
};
