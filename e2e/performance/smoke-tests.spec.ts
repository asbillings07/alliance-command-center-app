import { test, expect } from "../shared/fixtures";

/**
 * Performance Smoke Tests
 *
 * Not benchmarks - usability smoke tests.
 * Ensures pages load within reasonable time and feel usable.
 *
 * @tags @performance
 */
test.describe("Performance Smoke Tests", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;
  const testMemberId = process.env.TEST_MEMBER_ID;

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

  test("Dashboard loads within reasonable time", async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`/alliances/${testAllianceId}`);
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds (generous for cold start)
    expect(loadTime).toBeLessThan(5000);

    // Content should be visible
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("Members roster loads within reasonable time", async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`/alliances/${testAllianceId}/members`);
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(5000);

    await expect(
      page.getByRole("heading", { name: /roster/i })
    ).toBeVisible();
  });

  test("Member detail loads within reasonable time", async ({ page }) => {
    test.skip(!testMemberId, "TEST_MEMBER_ID required");

    const startTime = Date.now();

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(5000);
  });

  test("Metrics library loads within reasonable time", async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`/alliances/${testAllianceId}/metrics`);
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(5000);

    await expect(
      page.getByRole("heading", { name: /metrics library/i })
    ).toBeVisible();
  });

  test("Periods page loads within reasonable time", async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`/alliances/${testAllianceId}/periods`);
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(5000);

    await expect(
      page.getByRole("heading", { name: /evaluation periods/i })
    ).toBeVisible();
  });

  test("Login page loads quickly", async ({ page }) => {
    // Logout first by clearing cookies
    await page.context().clearCookies();

    const startTime = Date.now();

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    // Auth pages should be very fast
    expect(loadTime).toBeLessThan(3000);

    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });
});

test.describe("Large Dataset Performance", () => {
  const testAllianceId = process.env.TEST_LARGE_ALLIANCE_ID;

  test("Members roster with 100+ members loads acceptably", async ({ page }) => {
    test.skip(!testAllianceId, "TEST_LARGE_ALLIANCE_ID required for large dataset test");
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const startTime = Date.now();

    await page.goto(`/alliances/${testAllianceId}/members`);
    await page.waitForLoadState("networkidle");

    const loadTime = Date.now() - startTime;

    // Even with 100+ members, should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);

    // Table should be visible and contain data
    const rows = await page.locator("table tbody tr").count();
    expect(rows).toBeGreaterThan(0);
  });
});
