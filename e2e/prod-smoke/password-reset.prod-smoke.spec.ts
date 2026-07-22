import { test, expect } from "@playwright/test";
import {
  requireProdSmokeEnv,
  smokeAccounts,
  requireNewPassword,
  submitForgotPassword,
  loginWithPassword,
  expectAuthenticated,
  GENERIC_RESET_RESPONSE,
  SMOKE_ID,
} from "./smoke.helpers";

/**
 * Production smoke: password reset (#159).
 *
 * A few controlled requests against a live deployment — NOT a load test. The
 * suite is designed around a TWO-RUN flow so a single reset link is never
 * invalidated before it's consumed:
 *
 *   Run 1 (no SMOKE_RESET_LINK): the deterministic canaries run, and exactly
 *   ONE test ("issues a reset email…") requests a link for the password
 *   account. The operator fetches that link from the smoke inbox.
 *
 *   Run 2 (SMOKE_RESET_LINK pasted in): the link-generator test is skipped —
 *   so nothing re-requests a token and invalidates the pasted link — and the
 *   full-reset canary consumes it.
 *
 * Anti-enumeration deliberately probes the Google-only account (never the
 * password account) so it can't consume the link either.
 *
 * Runs only via the `prod-smoke` Playwright project; requireProdSmokeEnv() fails
 * closed unless the target is an explicit, https, host-locked, mutation-approved
 * origin.
 *
 * @tags @prod-smoke
 */
requireProdSmokeEnv();

const hasResetLink = Boolean(process.env.SMOKE_RESET_LINK);

test.describe("@prod-smoke password reset", () => {
  test("production is reachable and serving the login page", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /forgot your password/i })
    ).toBeVisible();
  });

  test("forgot-password returns the generic response for an unknown email", async ({
    page,
  }) => {
    await submitForgotPassword(page, `no-such-user-${SMOKE_ID}@example.test`);
    await expect(page.getByText(GENERIC_RESET_RESPONSE)).toBeVisible();
  });

  test("an invalid reset token shows the invalid state", async ({ page }) => {
    await page.goto("/reset-password/not-a-real-token");
    await expect(
      page.getByRole("heading", { name: /reset link invalid/i })
    ).toBeVisible();
  });

  test("the login page shows the post-reset banner", async ({ page }) => {
    await page.goto("/login?reset=success");
    await expect(
      page.getByText(/your password has been reset/i)
    ).toBeVisible();
  });

  test("anti-enumeration: an existing Google-only account looks like an unknown email", async ({
    page,
  }) => {
    test.skip(
      !process.env.SMOKE_GOOGLE_EMAIL,
      "SMOKE_GOOGLE_EMAIL required"
    );
    const { googleOnly } = smokeAccounts();

    // A real (Google-only, non-resettable) account must produce the SAME
    // response as an unknown email — no existence disclosure. Probing the
    // Google-only account never issues a password-reset token, so it can't
    // invalidate the link under test.
    await submitForgotPassword(page, `unknown-${SMOKE_ID}@example.test`);
    await expect(page.getByText(GENERIC_RESET_RESPONSE)).toBeVisible();

    await submitForgotPassword(page, googleOnly.email);
    await expect(page.getByText(GENERIC_RESET_RESPONSE)).toBeVisible();
  });

  test("password account can sign in and sign out", async ({ page }) => {
    test.skip(
      !process.env.SMOKE_PASSWORD_EMAIL || !process.env.SMOKE_PASSWORD_CURRENT,
      "SMOKE_PASSWORD_EMAIL + SMOKE_PASSWORD_CURRENT required"
    );
    const { password } = smokeAccounts();

    await loginWithPassword(page, password.email, password.currentPassword);
    await expectAuthenticated(page);

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
  });

  test("issues a reset email for the password account (fetch this link for run 2)", async ({
    page,
  }) => {
    // Only the FIRST run may request a token for the reset target. In run 2 this
    // is skipped so it can't invalidate the pasted SMOKE_RESET_LINK.
    test.skip(
      hasResetLink,
      "skipped when SMOKE_RESET_LINK is set (would invalidate the pasted link)"
    );
    test.skip(!process.env.SMOKE_PASSWORD_EMAIL, "SMOKE_PASSWORD_EMAIL required");
    const { password } = smokeAccounts();

    // Also confirms the resettable account returns the same generic response.
    await submitForgotPassword(page, password.email);
    await expect(page.getByText(GENERIC_RESET_RESPONSE)).toBeVisible();
  });

  test("completing a reset revokes sessions, rotates the password, and burns the link", async ({
    browser,
  }) => {
    test.skip(
      !hasResetLink,
      "SMOKE_RESET_LINK required (paste the link from the smoke inbox)"
    );
    const link = process.env.SMOKE_RESET_LINK!;
    const { password } = smokeAccounts();
    const newPassword = requireNewPassword();

    // 1. Establish a live authenticated session with the OLD password.
    const sessionCtx = await browser.newContext();
    const sessionPage = await sessionCtx.newPage();
    await loginWithPassword(
      sessionPage,
      password.email,
      password.currentPassword
    );
    await expectAuthenticated(sessionPage);
    const protectedUrl = sessionPage.url();

    // 2. In a fresh context, consume the emailed link to set a NEW password.
    const resetCtx = await browser.newContext();
    const resetPage = await resetCtx.newPage();
    await resetPage.goto(link);
    await resetPage.fill('input[name="password"]', newPassword);
    await resetPage.fill('input[name="confirmPassword"]', newPassword);
    await resetPage.getByRole("button", { name: /reset password/i }).click();
    await resetPage.waitForURL(/\/login\?reset=success/);

    // 3. The pre-existing session is revoked (sessionVersion bump).
    await sessionPage.goto(protectedUrl);
    await expect(sessionPage).toHaveURL(/\/login/);

    // 4. Old password no longer works; the new one does.
    await loginWithPassword(
      resetPage,
      password.email,
      password.currentPassword
    );
    await expect(
      resetPage.getByText(/invalid|incorrect|do(es)? not match/i)
    ).toBeVisible();

    await loginWithPassword(resetPage, password.email, newPassword);
    await expectAuthenticated(resetPage);

    // 5. The link is single-use: revisiting it is rejected.
    await resetPage.goto(link);
    await expect(
      resetPage.getByRole("heading", { name: /reset link invalid/i })
    ).toBeVisible();

    await sessionCtx.close();
    await resetCtx.close();

    // NOTE: the smoke account's password is now `newPassword`. Update the stored
    // SMOKE_PASSWORD_CURRENT secret to it before the next run.
  });
});
