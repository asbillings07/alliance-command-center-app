/**
 * Application URL helpers.
 *
 * Centralizes how the app resolves its own origin so invite links, email
 * links, and any other absolute URLs stay consistent.
 *
 * Guiding principle: the deployment *stack* selects the origin — the accidental
 * presence or absence of an environment variable must not. A Vercel Preview
 * deployment always uses its own per-deployment host, so an inherited or
 * mis-scoped NEXTAUTH_URL can never make a preview emit production links.
 *
 * Resolution order:
 *   1. VERCEL_ENV="preview" - always the per-deployment VERCEL_URL host, even if
 *                             NEXTAUTH_URL is present (it may be inherited).
 *   2. NEXTAUTH_URL         - the canonical origin (Vercel Production, self-hosted).
 *   3. localhost            - development/test convenience.
 */

type AppOriginEnv = {
  nodeEnv?: string;
  vercelEnv?: string;
  nextAuthUrl?: string;
  vercelUrl?: string;
};

/**
 * Pure origin resolver. Kept side-effect free (takes env as an argument) so it
 * is the single source of truth shared by {@link getAppOrigin} and the startup
 * validator in `env.ts` — the two can never drift.
 *
 * Returns the application origin (scheme + host [+ port], no trailing slash).
 * Throws a domain-specific error when the selected source is missing or not a
 * valid HTTP(S) URL, which is preferable to silently emitting a wrong link.
 */
export function resolveAppOrigin(env: AppOriginEnv): string {
  // The deployment stack is authoritative: a preview build always uses its own
  // host, closing the "inherited NEXTAUTH_URL" hole.
  if (env.vercelEnv === "preview") {
    if (!env.vercelUrl) {
      throw new Error(
        "Application origin is not configured: VERCEL_URL is required on Vercel Preview deployments.",
      );
    }
    return normalizeOrigin(`https://${env.vercelUrl}`, "VERCEL_URL");
  }

  if (env.nextAuthUrl) {
    return normalizeOrigin(env.nextAuthUrl, "NEXTAUTH_URL");
  }

  if (env.nodeEnv !== "production") {
    return "http://localhost:3000";
  }

  throw new Error(
    "Application origin is not configured: NEXTAUTH_URL is required in production.",
  );
}

/**
 * Resolve the application origin (scheme + host, no trailing slash) from the
 * current process environment. See {@link resolveAppOrigin} for the policy.
 */
export function getAppOrigin(): string {
  return resolveAppOrigin({
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    vercelUrl: process.env.VERCEL_URL,
  });
}

/**
 * Reduce a configured URL to its origin (scheme + host [+ port]), dropping any
 * path, query, hash, or trailing slash. Guarantees the "HTTP(S) scheme + host"
 * contract so callers can safely append their own path.
 *
 * Throws a domain-specific error (rather than a bare `TypeError: Invalid URL`)
 * on a malformed or non-HTTP(S) value so a misconfigured origin is actionable at
 * this startup-critical boundary. The offending value is deliberately NOT echoed
 * — the source name and expected format are enough, and config values are an
 * easy place for secrets to end up.
 */
function normalizeOrigin(value: string, source: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${source} must be a valid absolute HTTP(S) URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${source} must use http or https.`);
  }

  return parsed.origin;
}

/**
 * Build the absolute redeem URL for a beta invitation token.
 */
export function getRedeemUrl(token: string): string {
  return `${getAppOrigin()}/redeem/${encodeURIComponent(token)}`;
}

/**
 * Build the absolute acceptance URL for an alliance invitation token.
 */
export function getInviteUrl(token: string): string {
  return `${getAppOrigin()}/invite/${encodeURIComponent(token)}`;
}

/**
 * Build the absolute email-change verification URL for a raw token. The link
 * lands on a confirmation page (the change is completed via POST, never on
 * GET) so scanners and prefetchers cannot burn a single-use token.
 */
export function getEmailChangeVerifyUrl(rawToken: string): string {
  return `${getAppOrigin()}/account/email/verify/${encodeURIComponent(rawToken)}`;
}

/**
 * Build the absolute password reset URL for a raw (unhashed) reset token. The
 * token is URL-encoded so it survives transit intact as a single path segment.
 */
export function getResetPasswordUrl(rawToken: string): string {
  return `${getAppOrigin()}/reset-password/${encodeURIComponent(rawToken)}`;
}
