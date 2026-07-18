import { test, expect } from "../shared/fixtures";

/**
 * Password Reset E2E Tests
 *
 * Covers the observable surfaces of the reset flow: the request page's
 * anti-enumeration response, the invalid-token state, and the login page's
 * entry point + post-reset banner. The full happy path (consuming a real
 * emailed token) is covered by unit tests, since the token is only delivered
 * via email (the logging transport in the test environment).
 *
 * @tags @release-gate
 */
test.describe("Password reset", () => {
  test("login page links to forgot password", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("link", { name: /forgot your password/i })
    ).toBeVisible();
  });

  test("login page shows a success banner after a reset", async ({ page }) => {
    await page.goto("/login?reset=success");

    await expect(
      page.getByText(/your password has been reset/i)
    ).toBeVisible();
  });

  test("forgot password shows a generic response for an unknown email", async ({
    page,
  }) => {
    await page.goto("/forgot-password");

    await page.getByLabel(/email/i).fill("definitely-not-a-user@example.com");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });

  test("forgot password gives the same response for a known email (anti-enumeration)", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL,
      "TEST_OWNER_EMAIL required"
    );

    await page.goto("/forgot-password");

    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByRole("button", { name: /send reset link/i }).click();

    // Identical response to the unknown-email case: no disclosure of existence.
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });

  test("an invalid reset token shows the invalid state", async ({ page }) => {
    await page.goto("/reset-password/not-a-real-token");

    await expect(
      page.getByRole("heading", { name: /reset link invalid/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /request a new link/i })
    ).toBeVisible();
  });
});
