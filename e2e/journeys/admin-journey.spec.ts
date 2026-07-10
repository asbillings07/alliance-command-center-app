import { test, expect, AlliancePage } from "../shared/fixtures";

/**
 * Admin Journey E2E Test
 *
 * Tests the admin flow from invitation to collaborative setup.
 *
 * Journey steps:
 * 1. Accept invitation
 * 2. Register/login
 * 3. Access alliance dashboard
 * 4. Verify admin permissions
 * 5. Invite another collaborator
 */

test.describe("Admin Journey", () => {
  test.describe.configure({ mode: "serial" });

  // These would be set by test database seeding
  const testAllianceId = process.env.TEST_ALLIANCE_ID;
  const testInviteToken = process.env.TEST_ADMIN_INVITE_TOKEN;

  test.beforeAll(async () => {
    test.skip(
      !testAllianceId || !testInviteToken,
      "TEST_ALLIANCE_ID and TEST_ADMIN_INVITE_TOKEN required"
    );
  });

  test("can accept invitation via token URL", async ({ page }) => {
    test.skip(!testInviteToken, "Requires invite token");

    await page.goto(`/invite/${testInviteToken}`);

    // Should see invitation details
    await expect(page.locator('text="You\'ve been invited"')).toBeVisible();
    await expect(page.locator('a:has-text("Create Account")')).toBeVisible();
  });

  test("can accept invitation via code", async ({ page }) => {
    test.skip(
      !process.env.TEST_ADMIN_INVITE_CODE,
      "TEST_ADMIN_INVITE_CODE required"
    );

    await page.goto("/invite");
    await page.fill(
      'input[placeholder*="ABC"]',
      process.env.TEST_ADMIN_INVITE_CODE!
    );
    await page.click('button:has-text("Continue")');

    await expect(page).toHaveURL(/\/invite\//);
    await expect(page.locator('text="You\'ve been invited"')).toBeVisible();
  });

  test("can register and accept invitation", async ({ page, testUser }) => {
    test.skip(!testInviteToken, "Requires invite token");

    await page.goto(`/invite/${testInviteToken}`);
    await page.click('a:has-text("Create Account")');

    // Register
    await page.fill('input[name="displayName"]', testUser.displayName);
    await page.fill('input[name="password"]', testUser.password);
    await page.fill('input[name="confirmPassword"]', testUser.password);
    await page.click('button[type="submit"]');

    // Should redirect to accept the invitation and then to alliance
    await expect(page).toHaveURL(/\/alliances\//);
  });

  test("lands on dashboard (not setup) after accepting invite", async ({
    page,
  }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Admin should land on dashboard, not setup
    await expect(page).toHaveURL(new RegExp(`/alliances/${testAllianceId}$`));
    await expect(page.locator("h1:has-text('Alliance:')")).toBeVisible();
  });

  test("can access Metrics Library", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToMetrics(testAllianceId!);

    await expect(page.locator("h1:has-text('Metrics Library')")).toBeVisible();
    // Admin can create metrics
    await expect(
      page.locator('button:has-text("Create Metric")')
    ).toBeVisible();
  });

  test("can access Evaluation Periods", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToPeriods(testAllianceId!);

    await expect(
      page.locator("h1:has-text('Evaluation Periods')")
    ).toBeVisible();
    // Admin can create periods
    await expect(page.locator('button:has-text("Create Period")')).toBeVisible();
  });

  test("can access Members and import", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToMembers(testAllianceId!);

    await expect(page.locator("h1:has-text('Roster')")).toBeVisible();
    // Admin can import members
    await expect(page.locator('a:has-text("Import")')).toBeVisible();
  });

  test("can access Leadership Team and invite collaborators", async ({
    page,
  }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToInvitations(testAllianceId!);

    await expect(page.locator("h1:has-text('Leadership Team')")).toBeVisible();

    // Admin can invite collaborators
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(
      page.locator('button:has-text("Send Invitation")')
    ).toBeVisible();
  });

  test("cannot change owner role or access owner-only settings", async ({
    page,
  }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Admin should not see owner-level settings
    // This would depend on what owner-only features exist
    // For now, verify the role dropdown doesn't include OWNER when inviting
    const alliancePage = new AlliancePage(page);
    await alliancePage.navigateToInvitations(testAllianceId!);

    const roleSelect = page.locator('select[name="role"]');
    const options = await roleSelect.locator("option").allTextContents();

    expect(options).not.toContain("Owner");
  });
});
