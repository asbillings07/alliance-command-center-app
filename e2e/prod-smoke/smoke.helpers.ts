import { type Page, expect } from "@playwright/test";

/**
 * Safety rails + shared helpers for the production smoke suite.
 *
 * These specs are the ONLY ones that may run against a live, mutating
 * environment, so every guard here fails closed. The suite is opt-in three
 * times over: the `prod-smoke` Playwright project must be selected, PROD_SMOKE
 * must be "1", and ALLOW_PROD_MUTATIONS must be "true". A host lock stops us
 * from ever pointing the mutating suite at localhost, and (when configured) at
 * anything other than the expected hostname.
 */

export type SmokeConfig = {
  baseUrl: string;
  host: string;
};

/**
 * Throws (failing the run) unless every production-safety precondition holds.
 * All guards fail CLOSED: a missing or ambiguous value is an error, never a
 * silent "allow".
 */
export function requireProdSmokeEnv(): SmokeConfig {
  const errors: string[] = [];

  if (process.env.PROD_SMOKE !== "1") {
    errors.push("PROD_SMOKE must be '1'");
  }
  if (process.env.ALLOW_PROD_MUTATIONS !== "true") {
    errors.push(
      "ALLOW_PROD_MUTATIONS must be 'true' — explicit opt-in to write against a live environment"
    );
  }

  // The expected host is REQUIRED (no optional/allow-anything mode): the run
  // must state exactly which origin it intends to mutate.
  const expected = process.env.PROD_SMOKE_EXPECTED_HOST;
  if (!expected) {
    errors.push(
      "PROD_SMOKE_EXPECTED_HOST is required — the exact production host, e.g. 'alliancehqapp.com' (no scheme)"
    );
  }

  const baseUrl = process.env.PROD_SMOKE_BASE_URL ?? "";
  let parsed: URL | null = null;
  if (!baseUrl) {
    errors.push("PROD_SMOKE_BASE_URL is required");
  } else {
    try {
      parsed = new URL(baseUrl);
    } catch {
      errors.push(`PROD_SMOKE_BASE_URL is not a valid URL: ${baseUrl}`);
    }
  }

  if (parsed) {
    // Enforce the exact origin: https + an explicit host match. No plaintext,
    // no localhost, no "close enough" preview/staging URL.
    if (parsed.protocol !== "https:") {
      errors.push(
        `PROD_SMOKE_BASE_URL must use https (got '${parsed.protocol}')`
      );
    }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(parsed.host)) {
      errors.push(
        `Refusing to run the mutating smoke suite against '${parsed.host}'`
      );
    }
    if (expected && parsed.host !== expected) {
      errors.push(
        `PROD_SMOKE_BASE_URL host '${parsed.host}' does not match PROD_SMOKE_EXPECTED_HOST '${expected}'`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[prod-smoke] refusing to run:\n - ${errors.join("\n - ")}`
    );
  }

  return { baseUrl, host: parsed!.host };
}

/**
 * Stable, unique tag for every artifact this run creates, so cleanup (and a
 * human) can identify exactly what belongs to this smoke run.
 * e.g. "SMOKE-1753150000000".
 */
export const SMOKE_ID = `SMOKE-${process.env.PROD_SMOKE_RUN_ID ?? Date.now()}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[prod-smoke] missing required env ${name}`);
  return v;
}

export type SmokeAccounts = {
  /** Password-only account: exercises the full reset path. */
  password: { email: string; currentPassword: string };
  /** Google-only account: must get the same anti-enumeration response. */
  googleOnly: { email: string };
};

/**
 * Accounts the AUTOMATED canaries read. The dual-auth account is intentionally
 * absent: it's only exercised by the manual Google-after-reset checkpoint (see
 * the runbook), so requiring its credentials here would fail the suite for no
 * automated coverage.
 */
export function smokeAccounts(): SmokeAccounts {
  return {
    password: {
      email: requireEnv("SMOKE_PASSWORD_EMAIL"),
      currentPassword: requireEnv("SMOKE_PASSWORD_CURRENT"),
    },
    googleOnly: { email: requireEnv("SMOKE_GOOGLE_EMAIL") },
  };
}

/**
 * The password the full-reset canary will set. REQUIRED (no derived fallback):
 * the workflow run ID is public, so a run-ID-derived password would be
 * guessable. Supplied as a secret.
 */
export function requireNewPassword(): string {
  return requireEnv("SMOKE_PASSWORD_NEW");
}

/** The generic anti-enumeration response text shown by /forgot-password. */
export const GENERIC_RESET_RESPONSE = /if an account exists/i;

/** Submit an email on the forgot-password page. */
export async function submitForgotPassword(page: Page, email: string) {
  await page.goto("/forgot-password");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /send reset link/i }).click();
}

/** Sign in with credentials, targeting the credentials button (not Google). */
export async function loginWithPassword(
  page: Page,
  email: string,
  password: string
) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]:has-text("Sign In")');
}

/** True once we've landed on an authenticated surface. */
export async function expectAuthenticated(page: Page) {
  await page.waitForURL(/\/(app|alliances)/, { timeout: 15000 });
  await expect(page).toHaveURL(/\/(app|alliances)/);
}
