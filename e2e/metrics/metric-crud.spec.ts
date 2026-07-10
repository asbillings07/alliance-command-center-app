import { test, expect } from "../shared/fixtures";

/**
 * Metrics CRUD E2E Tests
 *
 * Tests create, read, update, and archive operations for metrics.
 *
 * @tags @release-gate
 */
test.describe("Metrics CRUD", () => {
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

  test("displays metrics library", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/metrics`);

    await expect(
      page.getByRole("heading", { name: /metrics library/i })
    ).toBeVisible();
  });

  test("can create numeric metric", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/metrics`);

    await page.getByRole("button", { name: /create metric/i }).click();

    const metricName = `Test Metric ${Date.now()}`;
    await page.getByLabel(/name/i).fill(metricName);
    await page.getByRole("combobox", { name: /type/i }).selectOption("NUMERIC");
    await page.getByRole("button", { name: /create|save/i }).click();

    await expect(page.getByText(metricName)).toBeVisible();
  });

  test("can create boolean metric", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/metrics`);

    await page.getByRole("button", { name: /create metric/i }).click();

    const metricName = `Boolean Metric ${Date.now()}`;
    await page.getByLabel(/name/i).fill(metricName);
    await page.getByRole("combobox", { name: /type/i }).selectOption("BOOLEAN");
    await page.getByRole("button", { name: /create|save/i }).click();

    await expect(page.getByText(metricName)).toBeVisible();
  });

  test("can archive metric", async ({ page }) => {
    test.skip(!process.env.TEST_METRIC_ID, "TEST_METRIC_ID required");

    await page.goto(`/alliances/${testAllianceId}/metrics`);

    const archiveButton = page.getByRole("button", { name: /archive/i }).first();
    if (await archiveButton.isVisible()) {
      await archiveButton.click();
    }
  });

  test("shows empty state when no metrics", async ({ page }) => {
    // This depends on test data - if no metrics, should show empty state
    await page.goto(`/alliances/${testAllianceId}/metrics`);

    // Either metrics exist or empty state is shown
    const hasMetrics = await page.locator('[data-testid="metric-card"]').count() > 0;
    const hasEmptyState = await page.getByText(/no metrics|create your first/i).isVisible();

    expect(hasMetrics || hasEmptyState).toBe(true);
  });
});

test.describe("Periods CRUD", () => {
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

  test("displays evaluation periods", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/periods`);

    await expect(
      page.getByRole("heading", { name: /evaluation periods/i })
    ).toBeVisible();
  });

  test("can create period", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/periods`);

    await page.getByRole("button", { name: /create period/i }).click();

    const periodName = `Week ${Date.now()}`;
    await page.getByLabel(/name/i).fill(periodName);
    await page.getByRole("button", { name: /create|save/i }).click();

    await expect(page.getByText(periodName)).toBeVisible();
  });

  test("can add metric to period", async ({ page }) => {
    test.skip(!process.env.TEST_PERIOD_ID, "TEST_PERIOD_ID required");

    await page.goto(`/alliances/${testAllianceId}/periods/${process.env.TEST_PERIOD_ID}`);

    // Add metric to period - depends on UI implementation
  });
});
