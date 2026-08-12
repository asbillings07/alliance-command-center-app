import "server-only";

/**
 * E2E-safe test override for `evaluateFeature`.
 *
 * Playwright exercises the actual built Next.js app as a separate process,
 * where vitest-style provider injection (`createEvaluator`) can't reach. This
 * module lets that process deterministically force specific flag values
 * without touching the real Vercel provider - gated tightly enough that no
 * real deployment can ever activate or be silently affected by it:
 *
 *  1. `FEATURE_FLAG_TEST_OVERRIDES` unset -> always a no-op (every real
 *     deployment today, since the var is never set there).
 *  2. Set, and `VERCEL` is present (true in every Vercel-managed context -
 *     Production, Preview, and Vercel's own build/dev runtime) -> throw
 *     immediately, unconditionally, regardless of `NODE_ENV`.
 *  3. Set, not on Vercel infra, and neither `NODE_ENV=test` (vitest) nor
 *     `ACC_E2E_MODE=1` (the locally built-and-started app Playwright drives
 *     via `next start`, which otherwise runs with `NODE_ENV=production` and
 *     would otherwise be indistinguishable from a real production process)
 *     -> throw immediately. An unmarked process must never silently honor or
 *     silently ignore the override.
 *  4. Otherwise, parse the JSON map of flag key -> boolean: malformed JSON,
 *     an unknown flag key, or a non-boolean value -> throw immediately,
 *     validating the whole map before applying any of it (never partially
 *     apply a map that fails validation). A flag absent from a validly
 *     parsed map simply isn't overridden.
 */

export type TestOverrideEnv = {
  featureFlagTestOverrides?: string;
  vercel?: string;
  nodeEnv?: string;
  accE2eMode?: string;
};

/**
 * Resolves the deterministic test-override value for `flagKey`, or
 * `undefined` if the override mechanism doesn't apply (unset, or the flag
 * simply isn't listed in a validly-parsed map) - in which case the caller
 * should fall through to the real provider.
 *
 * Throws for every activation-boundary violation described above, so a
 * misconfigured deploy fails loudly rather than silently honoring or
 * silently ignoring a test override.
 */
export function resolveTestOverride<Key extends string>(
  flagKey: Key,
  registryKeys: readonly Key[],
  env: TestOverrideEnv
): boolean | undefined {
  const raw = env.featureFlagTestOverrides;
  if (!raw) {
    return undefined;
  }

  if (env.vercel) {
    throw new Error(
      "FEATURE_FLAG_TEST_OVERRIDES must never be set in a Vercel-managed environment (VERCEL is set)."
    );
  }

  const isVitest = env.nodeEnv === "test";
  const isMarkedE2e = env.accE2eMode === "1";
  if (!isVitest && !isMarkedE2e) {
    throw new Error(
      "FEATURE_FLAG_TEST_OVERRIDES is set but this process is neither NODE_ENV=test nor " +
        "marked with ACC_E2E_MODE=1. Refusing to start rather than silently honoring or " +
        "silently ignoring a test override outside a recognized test context."
    );
  }

  const overrides = parseOverrides(raw, registryKeys);
  return Object.prototype.hasOwnProperty.call(overrides, flagKey) ? overrides[flagKey] : undefined;
}

function parseOverrides<Key extends string>(
  raw: string,
  registryKeys: readonly Key[]
): Record<Key, boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FEATURE_FLAG_TEST_OVERRIDES must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("FEATURE_FLAG_TEST_OVERRIDES must be a JSON object mapping flag keys to booleans.");
  }

  const validKeys = new Set<string>(registryKeys);
  const result = {} as Record<Key, boolean>;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!validKeys.has(key)) {
      throw new Error(`FEATURE_FLAG_TEST_OVERRIDES references unknown flag key "${key}".`);
    }
    if (typeof value !== "boolean") {
      throw new Error(`FEATURE_FLAG_TEST_OVERRIDES value for "${key}" must be a boolean.`);
    }
    result[key as Key] = value;
  }
  return result;
}
