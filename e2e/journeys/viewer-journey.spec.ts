import { test, expect } from "../shared/fixtures";

/**
 * Viewer Journey E2E Test
 *
 * Tests the viewer flow with read-only permissions.
 *
 * Journey steps:
 * 1. Accept invitation
 * 2. Register/login
 * 3. Access alliance dashboard
 * 4. Verify read-only permissions
 * 5. Verify cannot record/import or add notes
 */

test.describe("Viewer Journey", () => {
  test.describe.configure({ mode: "serial" });

  const testAllianceId = process.env.TEST_ALLIANCE_ID;
  const testInviteToken = process.env.TEST_VIEWER_INVITE_TOKEN;

  test.beforeAll(async () => {
    test.skip(
      !testAllianceId || !testInviteToken,
      "TEST_ALLIANCE_ID and TEST_VIEWER_INVITE_TOKEN required"
    );
  });

  test("can accept invitation and register", async ({ page, testUser }) => {
    test.skip(!testInviteToken, "Requires invite token");

    await page.goto(`/invite/${testInviteToken}`);
    await page.click('a:has-text("Create Account")');

    await page.fill('input[name="displayName"]', testUser.displayName);
    await page.fill('input[name="password"]', testUser.password);
    await page.fill('input[name="confirmPassword"]', testUser.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/alliances\//);
  });

  test("dashboard shows minimal navigation", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}`);

    // Viewer should NOT see these dashboard action links
    await expect(
      page.locator('a:has-text("Manage Metrics")')
    ).not.toBeVisible();
    await expect(
      page.locator('a:has-text("Manage Periods")')
    ).not.toBeVisible();
    await expect(
      page.locator('a:has-text("Manage Team")')
    ).not.toBeVisible();
    await expect(
      page.locator('a:has-text("Record Now")')
    ).not.toBeVisible();
  });

  test("can view members", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    // Should be able to view roster
    await expect(page.locator("h1:has-text('Roster')")).toBeVisible();
  });

  test("cannot see import link on members page", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    // Viewer should not see import option
    await expect(page.locator('a:has-text("Import")')).not.toBeVisible();
  });

  test("can view member details", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();

      // Should see member details with back link
      await expect(page.locator('a:has-text("← Back to Roster")')).toBeVisible();
    }
  });

  test("cannot see Edit or Archive buttons on member page", async ({
    page,
  }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();

      // Viewer should not see edit/archive controls
      await expect(page.locator('a:has-text("Edit")')).not.toBeVisible();
      await expect(
        page.locator('button:has-text("Archive")')
      ).not.toBeVisible();
    }
  });

  test("cannot add leadership notes", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();

      // Viewer should not see note creation UI
      await expect(
        page.locator('button:has-text("Add Leadership Note")')
      ).not.toBeVisible();
      await expect(
        page.locator('textarea[name="content"]')
      ).not.toBeVisible();
    }
  });

  test("cannot access record page directly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Try to access record page directly - should be redirected
    const testPeriodId = process.env.TEST_PERIOD_ID;
    if (testPeriodId) {
      await page.goto(
        `/alliances/${testAllianceId}/periods/${testPeriodId}/record`
      );

      // Should be redirected away (viewer lacks IMPORT_METRICS permission)
      await expect(page).not.toHaveURL(/\/record$/);
    }
  });

  test("cannot access import page directly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    const testPeriodId = process.env.TEST_PERIOD_ID;
    if (testPeriodId) {
      await page.goto(
        `/alliances/${testAllianceId}/periods/${testPeriodId}/import`
      );

      // Should be redirected away
      await expect(page).not.toHaveURL(/\/import$/);
    }
  });

  test("cannot access metrics page directly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/metrics`);

    // Should be redirected away (viewer lacks CONFIGURE_METRICS permission)
    await expect(page).not.toHaveURL(/\/metrics$/);
  });

  test("cannot access periods page directly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/periods`);

    // Should be redirected away
    await expect(page).not.toHaveURL(/\/periods$/);
  });

  test("cannot access invitations page directly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/settings/invitations`);

    // Should be redirected away
    await expect(page).not.toHaveURL(/\/invitations$/);
  });

  test("back links work correctly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Navigate to member and back
    await page.goto(`/alliances/${testAllianceId}/members`);

    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();
      await page.click('a:has-text("← Back to Roster")');

      await expect(page).toHaveURL(
        `/alliances/${testAllianceId}/members`
      );
    }
  });
});
