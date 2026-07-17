/**
 * Feature Flags
 *
 * Simple environment-based feature flags for safely exposing
 * features to beta users without code changes.
 *
 * Usage:
 *   if (isFeatureEnabled('platformConsole')) {
 *     // Show platform console
 *   }
 *
 * To enable a feature in production:
 *   FEATURE_PLATFORM_CONSOLE=true
 */

import type { ReactNode } from "react";

export const features = {
  /**
   * Platform Operations Console
   * Operational visibility for platform administrators
   */
  platformConsole: process.env.FEATURE_PLATFORM_CONSOLE === "true",

  /**
   * Recognition System
   * Member recognition and achievements (future)
   */
  recognition: process.env.FEATURE_RECOGNITION === "true",

  /**
   * Discord Integration
   * Sync with Discord servers (future)
   */
  discordIntegration: process.env.FEATURE_DISCORD === "true",

  /**
   * Analytics Dashboard
   * Advanced analytics and reporting (future)
   */
  analytics: process.env.FEATURE_ANALYTICS === "true",
} as const;

export type FeatureName = keyof typeof features;

/**
 * Check if a feature is enabled.
 */
export function isFeatureEnabled(feature: FeatureName): boolean {
  return features[feature] ?? false;
}

/**
 * Get all enabled features.
 */
export function getEnabledFeatures(): FeatureName[] {
  return (Object.keys(features) as FeatureName[]).filter(
    (feature) => features[feature]
  );
}

/**
 * Feature flag for use in React components.
 * Returns null if feature is disabled, children if enabled.
 */
export function FeatureFlag({
  feature,
  children,
  fallback = null,
}: {
  feature: FeatureName;
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return isFeatureEnabled(feature) ? children : fallback;
}
