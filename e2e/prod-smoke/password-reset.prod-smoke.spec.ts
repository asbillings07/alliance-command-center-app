import { test, expect } from "@playwright/test";
import {
  requireProdSmokeEnv,
  smokeAccounts,
  submitForgotPassword,
  loginWithPassword,
  expectAuthenticated,
  GENERIC_RESET_RESPONSE,
  SMOKE_ID,
} from "./smoke.helpers";

/**
 * Production smoke: password reset (#159).
 *
 * A few controlled requests against a live deployment — NOT a load test. Split
 * into deterministic canaries (no emailed link needed) and token-dependent
 * canaries gated on SMOKE_RESET_LINK: the operator fetches the real link from
 * the smoke inbox (the one genuinely manual step) and the rest stays automated.
 *
 * Runs only via the `prod-smoke` Playwright project; the safety rails below fail
 * closed if the environment isn't an explicit, host-locked, mutation-approved
 * target.
 *
 * @tags @prod-smoke
 */
requireProdSmokeEnv();

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

  test("anti-enumeration: password + Google-only accounts get the same response", async ({
    page,
  }) => {
    test.skip(
      !process.env.SMOKE_PASSWORD_EMAIL || !process.env.SMOKE_GOOGLE_EMAIL,
      "SMOKE_PASSWORD_EMAIL + SMOKE_GOOGLE_EMAIL required"
    );
    const { password, googleOnly } = smokeAccounts();

    await submitForgotPassword(page, password.email);
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

  test("completing a reset revokes sessions, rotates the password, and burns the link", async ({
    browser,
  }) => {
    test.skip(
      !process.env.SMOKE_RESET_LINK,
      "SMOKE_RESET_LINK required (paste the link from the smoke inbox)"
    );
    const link = process.env.SMOKE_RESET_LINK!;
    const { password } = smokeAccounts();

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
    await resetPage.fill('input[name="password"]', password.newPassword);
    await resetPage.fill('input[name="confirmPassword"]', password.newPassword);
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

    await loginWithPassword(resetPage, password.email, password.newPassword);
    await expectAuthenticated(resetPage);

    // 5. The link is single-use: revisiting it is rejected.
    await resetPage.goto(link);
    await expect(
      resetPage.getByRole("heading", { name: /reset link invalid/i })
    ).toBeVisible();

    await sessionCtx.close();
    await resetCtx.close();

    // NOTE: the smoke account's password is now `password.newPassword`. Update
    // the stored SMOKE_PASSWORD_CURRENT secret before the next run.
  });
});
