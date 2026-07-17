import { test, expect } from "../shared/fixtures";

/**
 * Platform Bootstrap E2E Tests
 *
 * Tests the /initialize first-run setup flow.
 *
 * Note: These tests are challenging because they require a database
 * without any platform admins. Most tests verify the redirect behavior
 * when the platform is already initialized.
 */

test.describe("Platform Bootstrap", () => {
  test.describe("When Platform is Initialized", () => {
    test("redirects /initialize to /login", async ({ page }) => {
      // Platform is already initialized in test environment
      await page.goto("/initialize");

      // Should redirect to login
      await page.waitForURL("/login");
      expect(page.url()).toContain("/login");
    });

    test("cannot access /initialize after login", async ({ page }) => {
      // Skip if platform admin credentials not available
      test.skip(
        !process.env.TEST_PLATFORM_ADMIN_EMAIL ||
          !process.env.TEST_PLATFORM_ADMIN_PASSWORD,
        "TEST_PLATFORM_ADMIN_EMAIL and TEST_PLATFORM_ADMIN_PASSWORD required"
      );

      // Login first
      await page.goto("/login");
      await page
        .getByLabel(/email/i)
        .fill(process.env.TEST_PLATFORM_ADMIN_EMAIL!);
      await page
        .getByLabel(/password/i)
        .fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD!);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/(app|alliances|platform)/);

      // Try to access /initialize
      await page.goto("/initialize");

      // Should still redirect to login (which then redirects to app)
      await page.waitForURL(/\/(login|app|alliances|platform)/);
      expect(page.url()).not.toContain("/initialize");
    });
  });

  test.describe("Initialize Page UI (when visible)", () => {
    // These tests document expected behavior but may be skipped
    // in environments where platform is already initialized

    test.skip("displays welcome message", async ({ page }) => {
      await page.goto("/initialize");

      await expect(
        page.getByRole("heading", { name: /Welcome to Alliance Command Center/i })
      ).toBeVisible();
      await expect(
        page.getByText(/No platform administrators exist yet/i)
      ).toBeVisible();
    });

    test.skip("displays initialization form", async ({ page }) => {
      await page.goto("/initialize");

      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/display name/i)).toBeVisible();
      await expect(page.getByLabel(/^password$/i)).toBeVisible();
      await expect(page.getByLabel(/confirm password/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Initialize Platform/i })
      ).toBeVisible();
    });

    test.skip("shows PLATFORM_ADMIN_EMAILS hint", async ({ page }) => {
      await page.goto("/initialize");

      await expect(
        page.getByText(/PLATFORM_ADMIN_EMAILS configuration/i)
      ).toBeVisible();
    });
  });
});
