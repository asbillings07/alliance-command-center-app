/**
 * Application URL helpers.
 *
 * Centralizes how the app resolves its own origin so invite links, email
 * links, and any other absolute URLs stay consistent. Uses NEXTAUTH_URL as the
 * canonical origin (same value Auth.js uses for callbacks).
 */

/**
 * Resolve the application origin (scheme + host, no trailing slash).
 *
 * Falls back to http://localhost:3000 in development/test when NEXTAUTH_URL is
 * unset. Throws in production so we never emit localhost links to real users.
 */
export function getAppOrigin(): string {
  const origin = process.env.NEXTAUTH_URL;

  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXTAUTH_URL must be configured in production");
    }
    return "http://localhost:3000";
  }

  return origin.replace(/\/$/, "");
}

/**
 * Build the absolute redeem URL for a beta invitation token.
 */
export function getRedeemUrl(token: string): string {
  return `${getAppOrigin()}/redeem/${token}`;
}
