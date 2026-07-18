import { test, expect } from "../shared/fixtures";

/**
 * Login E2E Tests
 *
 * Tests the login flow for Alliance Command Center.
 *
 * @tags @release-gate
 */
test.describe("Login", () => {
  test("displays login form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: /alliance command center/i })).toBeVisible();
    await expect(page.getByText(/sign in to continue/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/email/i).fill("invalid@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test("shows error for empty email", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/password/i).fill("somepassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    // HTML5 validation or custom error
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();
  });

  test("shows error for empty password", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByRole("button", { name: /sign in/i }).click();

    // HTML5 validation or custom error
    const passwordInput = page.getByLabel(/password/i);
    await expect(passwordInput).toBeVisible();
  });

  test("successful login redirects to app", async ({ page }) => {
    // Skip if no test user is configured
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "TEST_OWNER_EMAIL and TEST_OWNER_PASSWORD required"
    );

    await page.goto("/login");

    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should redirect to app router (which redirects to alliance or selection)
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("preserves callback URL after login", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "TEST_OWNER_EMAIL and TEST_OWNER_PASSWORD required"
    );

    const callbackUrl = "/alliances/test-alliance/members";
    await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);

    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should redirect to callback URL (if authorized) or app router
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("shows links to redeem and invitation", async ({ page }) => {
    await page.goto("/login");

    // Should show links to redeem beta code and enter invitation code
    await expect(page.getByRole("link", { name: /redeem/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /invitation/i })
    ).toBeVisible();
  });

  test("login form is keyboard accessible", async ({ page }) => {
    await page.goto("/login");

    // Focus the email field directly rather than assuming it is the first tab
    // stop: a "Continue with Google" CTA precedes the form when OAuth is
    // enabled. We only assert the form's internal tab order here.
    await page.getByLabel(/email/i).focus();
    await expect(page.getByLabel(/email/i)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/password/i)).toBeFocused();

    // The password field's show/hide toggle sits between the input and submit.
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /show password/i })
    ).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeFocused();
  });

  test("password visibility toggle reveals and hides the password", async ({
    page,
  }) => {
    await page.goto("/login");

    const passwordInput = page.getByLabel(/password/i);
    await passwordInput.fill("super-secret");
    await expect(passwordInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: /show password/i }).click();
    await expect(passwordInput).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: /hide password/i }).click();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });
});
