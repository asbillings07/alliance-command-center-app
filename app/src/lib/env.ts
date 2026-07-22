/**
 * Environment Validation
 *
 * Validates required environment variables at startup.
 * Fails fast if critical configuration is missing.
 */

import { resolveAppOrigin } from "./appUrl";
import { checkDbIdentity } from "./productionDb";

const requiredVars = ["DATABASE_URL", "AUTH_SECRET"] as const;

// Optional vars (not validated at startup, but typed for getEnv).
//
// NEXTAUTH_URL lives here rather than in requiredVars because whether it is
// required depends on the deployment stack: it is optional on Vercel Preview
// (the origin comes from VERCEL_URL) and required in production. That policy is
// owned entirely by resolveAppOrigin, which we exercise below, so validation can
// never drift from how URLs are actually built at runtime.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const optionalVars = [
  "NEXTAUTH_URL",
  "DIRECT_URL",
  "PRODUCTION_DB_HOSTS",
  "PREVIEW_EMAIL_ALLOWLIST",
  "PLATFORM_ADMIN_EMAILS",
  "PLATFORM_BOOTSTRAP_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "SENTRY_DSN",
  "FEATURE_PLATFORM_CONSOLE",
  "FEATURE_RECOGNITION",
  "FEATURE_DISCORD",
  "FEATURE_ANALYTICS",
] as const;

type RequiredVar = (typeof requiredVars)[number];
type OptionalVar = (typeof optionalVars)[number];

/**
 * Validate that all required environment variables are set.
 * Call this at application startup to fail fast on misconfiguration.
 */
export function validateEnv(): void {
  // Skip validation in test environment (tests set their own env)
  if (process.env.NODE_ENV === "test") {
    return;
  }

  // Skip validation during Next.js build phase
  // Build doesn't need runtime env vars - they're only needed at runtime
  // NEXT_PHASE is set by Next.js during build/generate phases
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const problems: string[] = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      problems.push(`${varName} is missing`);
    }
  }

  // Validate the application origin through the same resolver getAppOrigin uses,
  // so the "is NEXTAUTH_URL required here?" policy has a single source of truth
  // and a malformed origin fails at startup rather than when the first email is
  // sent. resolveAppOrigin returns a localhost fallback in development, so this
  // only surfaces genuine production/preview misconfiguration.
  try {
    resolveAppOrigin({
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      nextAuthUrl: process.env.NEXTAUTH_URL,
      vercelUrl: process.env.VERCEL_URL,
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  // Fail-closed database isolation (ADR-016): on Vercel, prove that Production
  // uses a production database and — critically — that Preview never does. A
  // shared production DB would let a preview build (possibly running unmerged
  // code) read or mutate real alliance data.
  for (const problem of checkDbIdentity()) {
    problems.push(problem);
  }

  if (problems.length > 0) {
    const message = [
      "========================================",
      "FATAL: Invalid environment configuration",
      "========================================",
      "",
      ...problems.map((p) => `- ${p}`),
      "",
      "Please ensure all required variables are set and valid.",
      "See .env.example for documentation.",
      "========================================",
    ].join("\n");

    console.error(message);

    // In development, warn but don't crash (allows gradual setup)
    if (process.env.NODE_ENV === "development") {
      console.warn("Continuing in development mode despite invalid configuration.");
      return;
    }

    throw new Error(`Invalid environment configuration: ${problems.join("; ")}`);
  }
}

/**
 * Get an environment variable with type safety.
 */
export function getEnv(name: RequiredVar): string;
export function getEnv(name: OptionalVar): string | undefined;
export function getEnv(name: RequiredVar | OptionalVar): string | undefined {
  return process.env[name];
}

/**
 * Check if running in production.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
