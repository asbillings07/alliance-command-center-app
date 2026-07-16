import { test, expect, AlliancePage } from "../shared/fixtures";

/**
 * Owner Journey E2E Test
 *
 * Tests the complete owner flow from beta invitation to full alliance setup.
 *
 * Journey steps:
 * 1. Redeem beta code
 * 2. Register new account
 * 3. Create alliance
 * 4. Complete setup checklist
 * 5. Invite collaborators
 */

test.describe("Owner Journey", () => {
  test.describe.configure({ mode: "serial" });

  let allianceId: string;

  test.beforeAll(async ({ browser: _browser }) => {
    // This test requires a beta invitation to be seeded in the database
    // For CI, you would seed this via a test database setup script
    // For local testing, you can create one with: npm run beta:invite <email>
  });

  test("can redeem beta code and see registration link", async ({ page }) => {
    // Skip if no beta code is available (manual seeding required)
    test.skip(
      !process.env.TEST_BETA_CODE,
      "TEST_BETA_CODE environment variable required"
    );

    await page.goto("/redeem");
    await expect(page.locator("h1")).toContainText("Join the Beta");

    // Enter beta code
    await page.fill('input[placeholder*="ABC"]', process.env.TEST_BETA_CODE!);
    await page.click('button:has-text("Continue")');

    // Should redirect to redemption page with registration link
    await expect(page).toHaveURL(/\/redeem\//);
    await expect(page.locator('text="Create Account"')).toBeVisible();
  });

  test("can register new account from beta invitation", async ({
    page,
    testUser,
  }) => {
    test.skip(
      !process.env.TEST_BETA_CODE,
      "TEST_BETA_CODE environment variable required"
    );

    // Navigate to registration from beta flow
    await page.goto("/redeem");
    await page.fill('input[placeholder*="ABC"]', process.env.TEST_BETA_CODE!);
    await page.click('button:has-text("Continue")');
    await page.click('a:has-text("Create Account")');

    await expect(page).toHaveURL(/\/register/);

    // Fill registration form
    const displayNameInput = page.locator('input[name="displayName"]');
    if (await displayNameInput.isVisible()) {
      await displayNameInput.fill(testUser.displayName);
    }

    await page.fill('input[name="password"]', testUser.password);
    await page.fill('input[name="confirmPassword"]', testUser.password);
    await page.click('button[type="submit"]');

    // Should redirect to create alliance
    await expect(page).toHaveURL(/\/create-alliance/);
  });

  test("can create alliance", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_CODE,
      "Requires authenticated beta user from previous test"
    );

    await expect(page).toHaveURL(/\/create-alliance/);
    await expect(
      page.locator("h1:has-text('Create Your Alliance')")
    ).toBeVisible();

    // Fill alliance name
    await page.fill('input[name="name"]', `Test Alliance ${Date.now()}`);
    await page.click('button[type="submit"]');

    // Should redirect to setup page
    await expect(page).toHaveURL(/\/alliances\/.*\/setup/);

    // Capture alliance ID from URL
    const url = page.url();
    const match = url.match(/\/alliances\/([^/]+)/);
    if (match) {
      allianceId = match[1];
    }
  });

  test("setup page shows incomplete checklist", async ({ page }) => {
    test.skip(!allianceId, "Requires alliance from previous test");

    await page.goto(`/alliances/${allianceId}/setup`);

    await expect(page.locator("h1:has-text('Alliance Setup')")).toBeVisible();

    // All tasks should initially be incomplete
    await expect(page.locator('text="Configure Metrics"')).toBeVisible();
    await expect(page.locator('text="Create Evaluation Period"')).toBeVisible();
    await expect(page.locator('text="Import Members"')).toBeVisible();
  });

  test("can configure metrics", async ({ page }) => {
    test.skip(!allianceId, "Requires alliance from previous test");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToMetrics(allianceId);

    await expect(page.locator("h1:has-text('Metrics Library')")).toBeVisible();

    // Create a metric
    await alliancePage.createMetric("VS Points", "NUMERIC");

    await expect(page.locator('text="VS Points"')).toBeVisible();
  });

  test("can create evaluation period", async ({ page }) => {
    test.skip(!allianceId, "Requires alliance from previous test");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToPeriods(allianceId);

    await expect(
      page.locator("h1:has-text('Evaluation Periods')")
    ).toBeVisible();

    // Create a period
    await alliancePage.createPeriod("Week 1");

    await expect(page.locator('text="Week 1"')).toBeVisible();
  });

  test("can navigate to dashboard", async ({ page }) => {
    test.skip(!allianceId, "Requires alliance from previous test");

    await page.goto(`/alliances/${allianceId}/setup`);

    // Click continue to dashboard
    await page.click('a:has-text("Continue to Dashboard")');

    await expect(page).toHaveURL(`/alliances/${allianceId}`);
    await expect(page.locator("h1:has-text('Alliance:')")).toBeVisible();
  });

  test("dashboard shows correct navigation for owner", async ({ page }) => {
    test.skip(!allianceId, "Requires alliance from previous test");

    await page.goto(`/alliances/${allianceId}`);

    // Owner should see all dashboard action links
    await expect(page.locator('a:has-text("Manage Metrics")')).toBeVisible();
    await expect(
      page.locator('a:has-text("Manage Periods")')
    ).toBeVisible();
    await expect(page.locator('a:has-text("Manage Team")')).toBeVisible();
  });

  test("can access leadership team and invite collaborators", async ({
    page,
  }) => {
    test.skip(!allianceId, "Requires alliance from previous test");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToInvitations(allianceId);

    await expect(page.locator("h1:has-text('Leadership Team')")).toBeVisible();

    // Invitation form should be visible
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="playerName"]')).toBeVisible();
    await expect(page.locator('select[name="role"]')).toBeVisible();
  });
});
