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

/** Throws (failing the run) unless every production-safety precondition holds. */
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

  const baseUrl = process.env.PROD_SMOKE_BASE_URL ?? "";
  let host = "";
  if (!baseUrl) {
    errors.push("PROD_SMOKE_BASE_URL is required");
  } else {
    try {
      host = new URL(baseUrl).host;
    } catch {
      errors.push(`PROD_SMOKE_BASE_URL is not a valid URL: ${baseUrl}`);
    }
  }

  if (host) {
    // Never mutate localhost, and — when the operator pins it — require an exact
    // hostname match so a stray preview/staging URL can't be smoke-tested as if
    // it were production.
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host)) {
      errors.push(`Refusing to run the mutating smoke suite against '${host}'`);
    }
    const expected = process.env.PROD_SMOKE_EXPECTED_HOST;
    if (expected && host !== expected) {
      errors.push(
        `PROD_SMOKE_BASE_URL host '${host}' does not match PROD_SMOKE_EXPECTED_HOST '${expected}'`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[prod-smoke] refusing to run:\n - ${errors.join("\n - ")}`
    );
  }

  return { baseUrl, host };
}

/**
 * Stable, unique tag for every artifact this run creates, so cleanup (and a
 * human) can identify exactly what belongs to this smoke run.
 * e.g. "SMOKE-1753150000000".
 */
export const SMOKE_ID = `SMOKE-${process.env.PROD_SMOKE_RUN_ID ?? Date.now()}`;

export type SmokeAccounts = {
  /** Password-only account: exercises the full reset path. */
  password: { email: string; currentPassword: string; newPassword: string };
  /** Google-only account: must get the same anti-enumeration response. */
  googleOnly: { email: string };
  /** Dual-auth account: Google login must still work after a password reset. */
  dualAuth: { email: string };
};

export function smokeAccounts(): SmokeAccounts {
  const require = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`[prod-smoke] missing required env ${name}`);
    return v;
  };
  return {
    password: {
      email: require("SMOKE_PASSWORD_EMAIL"),
      currentPassword: require("SMOKE_PASSWORD_CURRENT"),
      // Deterministic per-run so the operator can update the stored "current"
      // password after a successful reset run.
      newPassword: process.env.SMOKE_PASSWORD_NEW ?? `${SMOKE_ID}-pw-9f2`,
    },
    googleOnly: { email: require("SMOKE_GOOGLE_EMAIL") },
    dualAuth: { email: require("SMOKE_DUAL_EMAIL") },
  };
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
