import { test, expect } from "../shared/fixtures";

/**
 * Logout E2E Tests
 *
 * Verifies that an authenticated user can end their session from the
 * authenticated navigation and that the session is actually cleared afterward.
 *
 * @tags @release-gate
 */
test.describe("Logout", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;

  test.beforeEach(async ({ page }) => {
    test.skip(!testAllianceId, "TEST_ALLIANCE_ID required");
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("Sign Out is visible in the authenticated navigation", async ({
    page,
  }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("button", { name: /sign out/i })
    ).toBeVisible();
  });

  test("signing out returns the user to the login page", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await page.getByRole("button", { name: /sign out/i }).click();

    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test("after signing out, protected routes redirect to login", async ({
    page,
  }) => {
    await page.goto(`/alliances/${testAllianceId}`);
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);

    // The session cookie should be gone: hitting a protected route bounces
    // back to /login instead of rendering the dashboard.
    await page.goto(`/alliances/${testAllianceId}`);
    await expect(page).toHaveURL(/\/login/);
  });
});
