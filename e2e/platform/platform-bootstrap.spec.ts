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
      // After login, /app routes the user to their landing page. A platform
      // admin without an alliance lands on /redeem (or /create-alliance if an
      // alliance creation is pending), so allow those destinations too.
      await page.waitForURL(
        /\/(app|alliances|platform|redeem|create-alliance)/
      );

      // Try to access /initialize
      await page.goto("/initialize");

      // Should never render /initialize once the platform is initialized. An
      // authenticated user is bounced through /login to their landing page.
      await page.waitForURL(
        /\/(login|app|alliances|platform|redeem|create-alliance)/
      );
      expect(page.url()).not.toContain("/initialize");
    });
  });

  test.describe("Initialize Page UI", () => {
    // Note: These tests require an uninitialized database (no platform admins).
    // In CI, the database is seeded with a platform admin to run other tests,
    // so these are conditionally skipped. The redirect tests above verify that
    // the /initialize page correctly blocks access after initialization.
    //
    // To test bootstrap UI manually:
    // 1. Reset database: npx prisma migrate reset --skip-seed
    // 2. Run: npm run test:e2e -- --grep "Initialize Page UI"

    test.beforeEach(async ({ page }) => {
      // Check if platform is already initialized by trying to visit /initialize
      await page.goto("/initialize");
      const isInitialized = page.url().includes("/login");

      test.skip(
        isInitialized,
        "Platform already initialized - bootstrap UI not accessible"
      );
    });

    test("displays welcome message", async ({ page }) => {
      await expect(
        page.getByRole("heading", { name: /Welcome to Alliance Command Center/i })
      ).toBeVisible();
      await expect(
        page.getByText(/No platform administrators exist yet/i)
      ).toBeVisible();
    });

    test("displays initialization form", async ({ page }) => {
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/display name/i)).toBeVisible();
      await expect(page.getByLabel(/^password$/i)).toBeVisible();
      await expect(page.getByLabel(/confirm password/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Initialize Platform/i })
      ).toBeVisible();
    });

    test("shows PLATFORM_ADMIN_EMAILS hint", async ({ page }) => {
      await expect(
        page.getByText(/PLATFORM_ADMIN_EMAILS configuration/i)
      ).toBeVisible();
    });
  });
});
