import { test, expect } from "../shared/fixtures";

/**
 * Platform Bootstrap Success-Path E2E Test
 *
 * This lives in its own Playwright project ("bootstrap") because it assumes a
 * fundamentally different system state than the rest of the suite:
 *
 *   Application project -> platform IS initialized (seeded DB)
 *   Bootstrap project   -> platform DOES NOT exist yet (unseeded DB)
 *
 * Run it against a freshly reset database:
 *
 *   npm run test:e2e:bootstrap
 *
 * which runs `prisma migrate reset --force --skip-seed` first so no platform
 * admin exists, then executes only this project.
 *
 * Notes:
 * - The email must be authorized via PLATFORM_ADMIN_EMAILS / PLATFORM_ADMIN_EMAILS_E2E.
 * - The bootstrap secret field is filled only when PLATFORM_BOOTSTRAP_SECRET is
 *   configured (common in deployed/staging setups). When it is not set,
 *   verifyBootstrapSecret() permits initialization in non-production, so the
 *   field is left empty. This keeps the spec independent of the environment.
 */

const BOOTSTRAP_EMAIL =
  process.env.BOOTSTRAP_TEST_EMAIL ||
  process.env.PLATFORM_ADMIN_EMAILS_E2E?.split(",")[0]?.trim() ||
  process.env.TEST_PLATFORM_ADMIN_EMAIL ||
  "platform-admin@test.local";

const BOOTSTRAP_SECRET = process.env.PLATFORM_BOOTSTRAP_SECRET?.trim();

test.describe("Platform Bootstrap - Success Path", () => {
  test("initializes the platform and locks the initialize page", async ({
    page,
  }) => {
    // 1. /initialize is accessible on a fresh, uninitialized platform
    await page.goto("/initialize");
    await expect(
      page.getByRole("heading", {
        name: /Welcome to Alliance Command Center/i,
      })
    ).toBeVisible();

    // 2. Complete the first-run form with an authorized email
    await page.getByLabel(/email/i).fill(BOOTSTRAP_EMAIL);
    await page.getByLabel(/display name/i).fill("Bootstrap Admin");
    await page.getByLabel(/^password$/i).fill("BootstrapPass123!");
    await page.getByLabel(/confirm password/i).fill("BootstrapPass123!");

    // Provide the bootstrap secret when the environment requires one, so the
    // spec passes in both secret-configured and secret-less setups.
    if (BOOTSTRAP_SECRET) {
      await page.getByLabel(/bootstrap secret/i).fill(BOOTSTRAP_SECRET);
    }

    // 3. Submit and verify the operator lands in the Platform Console.
    // /platform immediately redirects to /platform/overview, so wait for the
    // final destination rather than the intermediate /platform URL.
    await page
      .getByRole("button", { name: /Initialize Platform/i })
      .click();
    await page.waitForURL(/\/platform\/overview\/?$/);
    expect(page.url()).toContain("/platform/overview");

    // 4. The platform is now initialized: /initialize is permanently locked
    await page.goto("/initialize");
    await page.waitForURL(/\/(login|app|alliances|platform)/);
    expect(page.url()).not.toContain("/initialize");
  });
});
