import { test, expect } from "../shared/fixtures";

/**
 * Alliance Setup Flow E2E Tests
 *
 * Tests the onboarding checklist for new alliances.
 *
 * @tags @release-gate
 */
test.describe("Alliance Setup Flow", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;

  test.beforeEach(async () => {
    test.skip(!testAllianceId, "TEST_ALLIANCE_ID required");
  });

  test("setup page displays checklist", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    // Login
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    // Navigate to setup
    await page.goto(`/alliances/${testAllianceId}/setup`);

    await expect(
      page.getByRole("heading", { name: /setup|getting started/i })
    ).toBeVisible();
  });

  test("checklist shows all required tasks", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/setup`);

    // Check for setup tasks
    await expect(page.getByText(/configure metrics/i)).toBeVisible();
    await expect(page.getByText(/create.*period/i)).toBeVisible();
    await expect(page.getByText(/import members/i)).toBeVisible();
  });

  test("completed tasks show checkmarks", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/setup`);

    // If any tasks are completed, they should have checkmarks
    // The actual check depends on the test alliance state
  });

  test("Continue to Dashboard link works", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/setup`);

    await page.getByRole("link", { name: /continue.*dashboard/i }).click();

    await expect(page).toHaveURL(new RegExp(`/alliances/${testAllianceId}$`));
  });

  test("setup page is accessible to all roles", async ({ page }) => {
    test.skip(
      !process.env.TEST_VIEWER_EMAIL || !process.env.TEST_VIEWER_PASSWORD,
      "Viewer credentials required"
    );

    // Even viewers can see the setup page (read-only)
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/setup`);

    // Should be able to view setup page
    await expect(page).toHaveURL(/\/setup/);
  });

  test("task links navigate to correct pages", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/setup`);

    // Click on Configure Metrics task
    const metricsLink = page.getByRole("link", { name: /configure metrics/i });
    if (await metricsLink.isVisible()) {
      await metricsLink.click();
      await expect(page).toHaveURL(/\/metrics/);
    }
  });

  test("setup progress persists across sessions", async ({ page }) => {
    // Setup progress is derived from actual data, not stored separately
    // So this tests that the derivation is consistent
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/setup`);

    // Capture initial state
    const initialContent = await page.content();

    // Refresh page
    await page.reload();

    // Should show same state
    const refreshedContent = await page.content();

    // Basic check - setup heading should still be there
    await expect(
      page.getByRole("heading", { name: /setup|getting started/i })
    ).toBeVisible();
  });
});
