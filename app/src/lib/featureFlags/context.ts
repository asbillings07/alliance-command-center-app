import "server-only";
import type { AuthorizationContext } from "../auth/permissions";

/**
 * Feature Flag Evaluation Context
 *
 * ADR-019 §2. Every populated field must be the return value of ACC's own
 * canonical authorization/tenant resolver - never a value read directly from
 * `params`, a request body, a header, or a cookie. A route parameter is
 * client-originated regardless of which server function reads it.
 */
export type FeatureContext = {
  environment: "production" | "preview" | "development";
  alliance?: { id: string; cohort?: string };
  userId?: string;
  isPlatformAdmin?: boolean;
};

type EnvironmentSource = {
  vercelEnv?: string;
};

/**
 * Pure environment resolver, mirroring the {@link resolveAppOrigin}/
 * {@link getAppOrigin} pattern in `../appUrl.ts`: side-effect free (takes env
 * as an argument) so it is trivially testable and has a single call site
 * reading `process.env` (below). The deployment stack (`VERCEL_ENV`) is
 * authoritative, never a caller-supplied value - this is what lets a
 * context-free flag (ADR-019 §2) build a `FeatureContext` before
 * authorization has run, from trusted process/deployment state only.
 */
export function resolveEnvironmentFrom(env: EnvironmentSource): FeatureContext["environment"] {
  if (env.vercelEnv === "production" || env.vercelEnv === "preview") {
    return env.vercelEnv;
  }
  return "development";
}

/**
 * Resolve the current environment from the actual process environment. See
 * {@link resolveEnvironmentFrom} for the policy.
 */
export function resolveEnvironment(): FeatureContext["environment"] {
  return resolveEnvironmentFrom({ vercelEnv: process.env.VERCEL_ENV });
}

/**
 * Build a {@link FeatureContext} from an already-resolved
 * {@link AuthorizationContext} (e.g. from `requireAllianceAccess`) and/or an
 * `isPlatformAdmin` flag from the same DB-backed check `requirePlatformAdmin`
 * uses. Never accepts raw `params`/headers/cookies - callers must have
 * already completed authorization before calling this for anything other
 * than a context-free global flag (ADR-019 §2).
 */
export function toFeatureContext(options: {
  environment: FeatureContext["environment"];
  authorization?: Pick<AuthorizationContext, "user" | "membership">;
  isPlatformAdmin?: boolean;
}): FeatureContext {
  return {
    environment: options.environment,
    // Optional-chained all the way through: a real `AuthorizationContext`
    // (from `requireAllianceAccess`) always has both, but callers pass this
    // through unmodified, and this must never throw on a partially-shaped
    // value.
    alliance: options.authorization?.membership?.allianceId
      ? { id: options.authorization.membership.allianceId }
      : undefined,
    userId: options.authorization?.user?.id,
    isPlatformAdmin: options.isPlatformAdmin,
  };
}
