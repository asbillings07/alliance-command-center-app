/**
 * Environment Validation
 *
 * Validates required environment variables at startup.
 * Fails fast if critical configuration is missing.
 */

const requiredVars = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

const optionalVars = [
  "PLATFORM_ADMIN_EMAILS",
  "SENTRY_DSN",
  "FEATURE_PLATFORM_CONSOLE",
  "FEATURE_RECOGNITION",
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

  const missing: string[] = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const message = [
      "========================================",
      "FATAL: Missing required environment variables",
      "========================================",
      "",
      `Missing: ${missing.join(", ")}`,
      "",
      "Please ensure all required variables are set.",
      "See .env.example for documentation.",
      "========================================",
    ].join("\n");

    console.error(message);

    // In development, warn but don't crash (allows gradual setup)
    if (process.env.NODE_ENV === "development") {
      console.warn("Continuing in development mode despite missing variables.");
      return;
    }

    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
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
