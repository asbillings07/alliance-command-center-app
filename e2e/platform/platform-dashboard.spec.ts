import { test, expect } from "../shared/fixtures";

/**
 * Platform Dashboard E2E Test
 *
 * Tests the /platform operational dashboard functionality.
 *
 * Note: These tests require a platform admin user to be authenticated.
 * The platform dashboard is separate from alliance authorization -
 * it's for platform operators, not alliance administrators.
 */

test.describe("Platform Dashboard", () => {
  test("dashboard loads successfully", async ({ page }) => {
    await page.goto("/platform");

    await expect(page.locator("h1:has-text('Platform Dashboard')")).toBeVisible();
    await expect(
      page.locator('text="Operational visibility into beta progress"')
    ).toBeVisible();
  });

  test("displays alliance stats section", async ({ page }) => {
    await page.goto("/platform");

    await expect(page.locator("h2:has-text('Alliances')")).toBeVisible();
    await expect(page.locator('text="Total Alliances"')).toBeVisible();
    await expect(page.locator('text="Active Today"')).toBeVisible();
    await expect(page.locator('text="New This Week"')).toBeVisible();
  });

  test("displays user stats section", async ({ page }) => {
    await page.goto("/platform");

    await expect(page.locator("h2:has-text('Users')")).toBeVisible();
    await expect(page.locator('text="Total Users"')).toBeVisible();
    await expect(page.locator('text="Owners"')).toBeVisible();
    await expect(page.locator('text="Admins"')).toBeVisible();
    await expect(page.locator('text="Leaders"')).toBeVisible();
    await expect(page.locator('text="Viewers"')).toBeVisible();
  });

  test("displays alliance readiness section", async ({ page }) => {
    await page.goto("/platform");

    await expect(
      page.locator("h2:has-text('Alliance Readiness')")
    ).toBeVisible();
    await expect(page.locator('text="Ready"')).toBeVisible();
    await expect(page.locator('text="Needs Setup"')).toBeVisible();
    await expect(page.locator('text="New (< 7 days)"')).toBeVisible();
  });

  test("displays setup funnel section", async ({ page }) => {
    await page.goto("/platform");

    await expect(page.locator("h2:has-text('Setup Funnel')")).toBeVisible();
    await expect(page.locator('text="Beta Invited"')).toBeVisible();
    await expect(page.locator('text="Beta Accepted"')).toBeVisible();
    await expect(page.locator('text="Alliance Created"')).toBeVisible();
    await expect(page.locator('text="Invited Collaborator"')).toBeVisible();
    await expect(page.locator('text="Collaborator Accepted"')).toBeVisible();
    await expect(page.locator('text="Metrics Configured"')).toBeVisible();
    await expect(page.locator('text="Members Imported"')).toBeVisible();
    await expect(page.locator('text="First Dataset Imported"')).toBeVisible();
  });

  test("displays needs attention section", async ({ page }) => {
    await page.goto("/platform");

    await expect(page.locator("h2:has-text('Needs Attention')")).toBeVisible();

    // Should show either items or "No items need attention" message
    const needsAttention = page.locator('h2:has-text("Needs Attention")').locator('..').locator('..');
    const hasItems = await needsAttention.locator('.bg-\\[\\#1F2937\\]').count() > 0;
    const hasEmptyState = await page.locator('text="No items need attention"').isVisible();

    expect(hasItems || hasEmptyState).toBe(true);
  });

  test("displays recent activity section", async ({ page }) => {
    await page.goto("/platform");

    await expect(page.locator("h2:has-text('Recent Activity')")).toBeVisible();

    // Should show either activity items or "No recent activity" message
    const activityCount = await page.locator('text="Recorded metrics"').count();
    const allianceCount = await page.locator('text="Alliance created"').count();
    const hasActivity = activityCount > 0 || allianceCount > 0;
    const hasEmptyState = await page.locator('text="No recent activity"').isVisible();

    expect(hasActivity || hasEmptyState).toBe(true);
  });

  test("stat cards display numeric values", async ({ page }) => {
    await page.goto("/platform");

    // Check that stat card values are numeric (inside the stat card containers)
    // Stat cards have the bg-[#1F2937] class and contain .text-2xl.font-bold values
    const statCardSection = page.locator('h2:has-text("Alliances")').locator('..');
    const statValues = statCardSection.locator('.text-2xl.font-bold');
    const count = await statValues.count();

    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await statValues.nth(i).textContent();
      expect(text).toMatch(/^\d+$/);
    }
  });

  test("funnel bars render correctly", async ({ page }) => {
    await page.goto("/platform");

    // Each funnel stage should have a bar
    const funnelBars = page.locator('.h-6.bg-\\[\\#374151\\]');
    const barCount = await funnelBars.count();

    expect(barCount).toBeGreaterThanOrEqual(8); // 8 funnel stages
  });
});
