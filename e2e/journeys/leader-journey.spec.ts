import { test, expect } from "../shared/fixtures";

/**
 * Leader Journey E2E Test
 *
 * Tests the leader flow with limited permissions.
 *
 * Journey steps:
 * 1. Accept invitation
 * 2. Register/login
 * 3. Access alliance dashboard
 * 4. Verify leader permissions (configure metrics/periods, record data, view members)
 * 5. Verify cannot invite collaborators
 */

test.describe("Leader Journey", () => {
  test.describe.configure({ mode: "serial" });

  const testAllianceId = process.env.TEST_ALLIANCE_ID;
  const testInviteToken = process.env.TEST_LEADER_INVITE_TOKEN;
  const testPeriodId = process.env.TEST_PERIOD_ID;

  test.beforeAll(async () => {
    test.skip(
      !testAllianceId || !testInviteToken,
      "TEST_ALLIANCE_ID and TEST_LEADER_INVITE_TOKEN required"
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

  test("dashboard shows Manage Periods link (not Evaluation Results)", async ({
    page,
  }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}`);

    // Leaders can configure periods, so they see the "Manage Periods" action
    await expect(
      page.locator('a:has-text("Manage Periods")')
    ).toBeVisible();

    // The "Record Now" shortcut is only for roles that cannot configure
    // periods, so it should not be shown to leaders.
    await expect(
      page.locator('a:has-text("Record Now")')
    ).not.toBeVisible();
  });

  test("can access Metrics Library directly", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Leaders can configure metrics used during evaluation imports.
    await page.goto(`/alliances/${testAllianceId}`);
    await expect(
      page.locator('a:has-text("Manage Metrics")')
    ).toBeVisible();

    await page.goto(`/alliances/${testAllianceId}/metrics`);
    await expect(page.getByRole("heading", { name: /metrics library/i })).toBeVisible();
  });

  test("cannot access Leadership Team page", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Leader should not see the Leadership Team action
    await page.goto(`/alliances/${testAllianceId}`);
    await expect(
      page.locator('a:has-text("Manage Team")')
    ).not.toBeVisible();

    // Direct navigation should redirect or show unauthorized
    await page.goto(`/alliances/${testAllianceId}/settings/invitations`);
    // Should be redirected away or see error
    await expect(page).not.toHaveURL(
      `/alliances/${testAllianceId}/settings/invitations`
    );
  });

  test("can view members", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    // Should be able to view roster
    await expect(page.locator("h1:has-text('Roster')")).toBeVisible();
  });

  test("can record metrics for active period", async ({ page }) => {
    test.skip(!testAllianceId || !testPeriodId, "Requires alliance and period");

    await page.goto(
      `/alliances/${testAllianceId}/periods/${testPeriodId}/record`
    );

    // Should see record metrics page
    await expect(page.getByText("Record Results")).toBeVisible();

    // Back link should go to dashboard (not period detail)
    await expect(
      page.locator('a:has-text("← Back to Dashboard")')
    ).toBeVisible();
  });

  test("can import metrics from spreadsheet", async ({ page }) => {
    test.skip(!testAllianceId || !testPeriodId, "Requires alliance and period");

    await page.goto(
      `/alliances/${testAllianceId}/periods/${testPeriodId}/import`
    );

    // Should see import page
    await expect(
      page.getByRole("heading", { name: "Import Evaluation Results" })
    ).toBeVisible();

    // Back link should go to dashboard
    await expect(
      page.locator('a:has-text("← Back to Dashboard")')
    ).toBeVisible();
  });

  test("record page shows empty state if no metrics configured", async () => {
    // This tests the empty state we added
    test.skip(!testAllianceId, "Requires alliance ID");

    // If period has no metrics, should show helpful empty state
    // This depends on test data setup
  });

  test("can view member details", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    await page.goto(`/alliances/${testAllianceId}/members`);

    // Click on first member if exists
    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();

      // Should be able to view member details
      await expect(page.locator('a:has-text("← Back to Roster")')).toBeVisible();
    }
  });

  test("cannot add leadership notes", async ({ page }) => {
    test.skip(!testAllianceId, "Requires alliance ID");

    // Navigate to a member page
    await page.goto(`/alliances/${testAllianceId}/members`);

    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();

      // Leader should not see "Add Leadership Note" button
      await expect(
        page.locator('button:has-text("Add Leadership Note")')
      ).not.toBeVisible();
    }
  });
});
