/**
 * Application URL helpers.
 *
 * Centralizes how the app resolves its own origin so invite links, email
 * links, and any other absolute URLs stay consistent.
 *
 * Origin resolution is deliberately ordered so each deployment "stack" gets the
 * right absolute URLs:
 *   1. NEXTAUTH_URL   - the canonical origin (same value Auth.js uses). Set only
 *                       in Production, so production links always use the custom
 *                       domain rather than an internal *.vercel.app host.
 *   2. VERCEL_URL     - the per-deployment host Vercel exposes on Preview builds,
 *                       where NEXTAUTH_URL is intentionally left unset so Auth.js
 *                       (and these links) follow the actual preview deployment
 *                       instead of bouncing to production.
 *   3. localhost      - development/test convenience.
 */

/**
 * Resolve the application origin (scheme + host, no trailing slash).
 *
 * Prefers NEXTAUTH_URL, then Vercel's per-deployment VERCEL_URL, then localhost
 * in development/test. Throws only in production when none of these is available,
 * so we never emit a wrong or localhost link to real users.
 */
export function getAppOrigin(): string {
  const configured = process.env.NEXTAUTH_URL;
  if (configured) {
    return normalizeOrigin(configured, "NEXTAUTH_URL");
  }

  // Preview deployments leave NEXTAUTH_URL unset. VERCEL_URL is the deployment
  // host only (no scheme) and is always served over https.
  const vercelHost = process.env.VERCEL_URL;
  if (vercelHost) {
    return normalizeOrigin(`https://${vercelHost}`, "VERCEL_URL");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  throw new Error(
    "Application origin is not configured: set NEXTAUTH_URL (production) or run on Vercel (VERCEL_URL, preview).",
  );
}

/**
 * Reduce a configured URL to its origin (scheme + host [+ port]), dropping any
 * path, query, hash, or trailing slash. Guarantees the "scheme + host" contract
 * so callers can safely append their own path.
 *
 * Throws a domain-specific error on a non-absolute/malformed value (rather than
 * a bare `TypeError: Invalid URL`) so a misconfigured origin is actionable at
 * this startup-critical boundary.
 */
function normalizeOrigin(value: string, source: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(
      `${source} is not a valid absolute URL (expected e.g. "https://example.com"), received: ${value}`,
    );
  }
}

/**
 * Build the absolute redeem URL for a beta invitation token.
 */
export function getRedeemUrl(token: string): string {
  return `${getAppOrigin()}/redeem/${token}`;
}

/**
 * Build the absolute acceptance URL for an alliance invitation token.
 */
export function getInviteUrl(token: string): string {
  return `${getAppOrigin()}/invite/${token}`;
}

/**
 * Build the absolute email-change verification URL for a raw token. The link
 * lands on a confirmation page (the change is completed via POST, never on
 * GET) so scanners and prefetchers cannot burn a single-use token.
 */
export function getEmailChangeVerifyUrl(rawToken: string): string {
  return `${getAppOrigin()}/account/email/verify/${rawToken}`;
}
