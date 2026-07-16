import { test, expect } from "../shared/fixtures";

/**
 * Registration E2E Tests
 *
 * Tests the registration flow for Alliance Command Center.
 * Note: Registration requires either a beta invitation or alliance invitation.
 *
 * @tags @release-gate
 */
test.describe("Registration", () => {
  test("cannot access registration without invitation", async ({ page }) => {
    await page.goto("/register");
    await page.waitForLoadState("networkidle");

    // Should show "Invitation Required" heading
    await expect(
      page.getByRole("heading", { name: /invitation required/i })
    ).toBeVisible();
  });

  test("registration form displays required fields", async ({ page }) => {
    // Access registration with a valid callback (simulating invitation flow)
    // Without actual invitation, we test the form structure
    test.skip(
      !process.env.TEST_BETA_TOKEN,
      "TEST_BETA_TOKEN required for registration test"
    );

    await page.goto(`/register?callbackUrl=/redeem/${process.env.TEST_BETA_TOKEN}`);

    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/display name/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByLabel(/confirm password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create account/i })
    ).toBeVisible();
  });

  test("shows password mismatch error", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_TOKEN,
      "TEST_BETA_TOKEN required for registration test"
    );

    await page.goto(`/register?callbackUrl=/redeem/${process.env.TEST_BETA_TOKEN}`);

    await page.getByLabel(/display name/i).fill("Test User");
    await page.getByLabel(/^password$/i).fill("Password123!");
    await page.getByLabel(/confirm password/i).fill("DifferentPassword!");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test("shows weak password error", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_TOKEN,
      "TEST_BETA_TOKEN required for registration test"
    );

    await page.goto(`/register?callbackUrl=/redeem/${process.env.TEST_BETA_TOKEN}`);

    await page.getByLabel(/display name/i).fill("Test User");
    await page.getByLabel(/^password$/i).fill("weak");
    await page.getByLabel(/confirm password/i).fill("weak");
    await page.getByRole("button", { name: /create account/i }).click();

    // Should show password requirements error
    await expect(
      page.getByText(/password must|at least|characters/i)
    ).toBeVisible();
  });

  test("shows link to login for existing users", async ({ page }) => {
    await page.goto("/register");

    await expect(
      page.getByRole("link", { name: /sign in|login/i })
    ).toBeVisible();
  });

  test("registration form is keyboard accessible", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_TOKEN,
      "TEST_BETA_TOKEN required for registration test"
    );

    await page.goto(`/register?callbackUrl=/redeem/${process.env.TEST_BETA_TOKEN}`);

    // Should be able to tab through all fields
    const email = page.getByLabel(/email/i);
    const displayName = page.getByLabel(/display name/i);
    const password = page.getByLabel(/^password$/i);
    const confirmPassword = page.getByLabel(/confirm password/i);

    await email.focus();
    await page.keyboard.press("Tab");
    await expect(displayName).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(confirmPassword).toBeFocused();
  });
});
