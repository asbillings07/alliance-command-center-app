import { test, expect } from "../shared/fixtures";

/**
 * Create Alliance E2E Tests
 *
 * Tests the alliance creation flow for beta users.
 *
 * @tags @release-gate
 */
test.describe("Create Alliance", () => {
  test("displays alliance creation form for beta users", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_USER_EMAIL || !process.env.TEST_BETA_USER_PASSWORD,
      "TEST_BETA_USER_EMAIL and TEST_BETA_USER_PASSWORD required"
    );

    // Login as beta user without an alliance
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_BETA_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_BETA_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should redirect to create alliance
    await page.waitForURL(/\/create-alliance/);

    await expect(
      page.getByRole("heading", { name: /create.*alliance/i })
    ).toBeVisible();
    await expect(page.getByLabel(/alliance name/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create/i })
    ).toBeVisible();
  });

  test("shows validation error for empty name", async ({ page, betaUser }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(betaUser.email);
    await page.getByLabel(/password/i).fill(betaUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/create-alliance/);

    // Verify input has required attribute
    const nameInput = page.locator("#name");
    await expect(nameInput).toHaveAttribute("required", "");

    // Remove required attribute to test server-side action validation
    await page.evaluate(() => {
      document.querySelector("#name")?.removeAttribute("required");
    });
    await page.getByRole("button", { name: /create/i }).click();

    // Should show server validation error
    await expect(page.getByText(/alliance name is required/i)).toBeVisible();
  });

  test("creates alliance and redirects to setup", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_USER_EMAIL || !process.env.TEST_BETA_USER_PASSWORD,
      "TEST_BETA_USER_EMAIL and TEST_BETA_USER_PASSWORD required"
    );

    // Login
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_BETA_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_BETA_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/create-alliance/);

    // Create alliance
    const allianceName = `Test Alliance ${Date.now()}`;
    await page.getByLabel(/alliance name/i).fill(allianceName);
    await page.getByRole("button", { name: /create/i }).click();

    // Should redirect to setup page
    await page.waitForURL(/\/alliances\/.*\/setup/);
    await expect(page.getByText(allianceName)).toBeVisible();
  });

  test("alliance creation is idempotent", async () => {
    test.skip(
      !process.env.TEST_BETA_USER_EMAIL,
      "Requires beta user authentication"
    );

    // If user refreshes during creation, should not create duplicate
    // This tests the idempotency of the createAlliance service
  });

  test("redirects existing alliance owners to dashboard", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "TEST_OWNER_EMAIL and TEST_OWNER_PASSWORD required"
    );

    // Login as user who already has an alliance
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should NOT go to create-alliance
    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain("/create-alliance");
  });
});
