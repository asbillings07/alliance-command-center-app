import "server-only";

/**
 * Feature Flag Registry
 *
 * The single, typed source of truth for every feature flag ACC evaluates, per
 * ADR-019 §8 (docs/adr/019-feature-flag-targeting-lifecycle-contract.md).
 *
 * Referencing an undefined flag key is a compile-time error: `FeatureFlagKey`
 * is an explicit string-literal union (not `keyof typeof featureFlagRegistry`
 * inferred loosely), so `evaluateFeature("typo", ctx)` fails to type-check
 * rather than silently resolving to `undefined` at runtime.
 */

export type FeatureFlagCategory = "temporary-release" | "operational-kill-switch";

/**
 * How a flag *can* be targeted - never the live alliance/segment membership
 * itself. That list is exclusively Vercel Flags dashboard configuration
 * (targeting rules/segments); recording it here too would create a second,
 * driftable source of truth for the same fact (ADR-019 §8).
 */
export type FeatureFlagTargetingStrategy = "global" | "alliance-targeted" | "operator-only";

export type FeatureFlagDefinition = {
  key: string;
  description: string;
  category: FeatureFlagCategory;
  owner: string;
  /** The issue that originated this flag/feature. */
  issue: string;
  /**
   * The category-specific default (ADR-019 §4) - what the flag resolves to
   * when the provider's own fallback chain is exhausted. For a
   * `temporary-release` flag this is always `false`: it is never today's
   * live production value, which is reproduced by Vercel dashboard
   * configuration instead (see the Slice B cutover in #331).
   */
  productionDefault: boolean;
  targetingStrategy: FeatureFlagTargetingStrategy;
  /** ISO date - a review checkpoint, not a hard expiration. */
  expiresOn: string;
  /**
   * Required at registry-entry creation time, not deferred until deletion
   * (ADR-019 §1/§8's "from day one" rule).
   */
  removalIssue: string;
};

export type FeatureFlagKey = "reports" | "dashboard-workflow-groups";

export const featureFlagRegistry: Record<FeatureFlagKey, FeatureFlagDefinition> = {
  reports: {
    key: "reports",
    description:
      "Metric Summary Reports (#190): per-metric alliance rollups, rankings, " +
      "and member breakdowns. Ships dark - both report routes fail closed " +
      "(notFound) while disabled, and all discovery touchpoints (dashboard, " +
      "Metrics Library, period detail) hide their links too.",
    category: "temporary-release",
    owner: "Engineering",
    issue: "#190",
    productionDefault: false,
    targetingStrategy: "global",
    expiresOn: "2026-11-11",
    removalIssue: "#336",
  },
  "dashboard-workflow-groups": {
    key: "dashboard-workflow-groups",
    description:
      "Grouped alliance dashboard (#192): reorganizes the dashboard into " +
      "leader-workflow groups (Setup and data freshness, Roster health, " +
      "Participation and evaluation) instead of a flat module grid. ACC's " +
      "first alliance-targeted flag (#332) - proves selected-alliance " +
      "rollout of a substantial user-facing redesign. Ships dark - while " +
      "disabled, the existing dashboard renders unchanged and no route or " +
      "action unique to the new layout is discoverable.",
    category: "temporary-release",
    owner: "Engineering",
    issue: "#192",
    productionDefault: false,
    targetingStrategy: "alliance-targeted",
    expiresOn: "2026-12-01",
    removalIssue: "#342",
  },
};
