import { test, expect } from "../shared/fixtures";

/**
 * Dashboard Navigation E2E Tests
 *
 * Tests the alliance dashboard functionality.
 *
 * @tags @release-gate
 */
test.describe("Dashboard Navigation", () => {
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

  test("dashboard loads without error", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("shows alliance name", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    // Alliance name should be visible somewhere on the page
    await expect(page.getByText(/alliance/i)).toBeVisible();
  });

  test("Members link works", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await page.getByRole("link", { name: /members|roster/i }).click();

    await expect(page).toHaveURL(/\/members/);
  });

  test("Owner sees Metrics Library link", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("link", { name: /metrics library/i })
    ).toBeVisible();
  });

  test("Owner sees Evaluation Periods link", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("link", { name: /evaluation periods/i })
    ).toBeVisible();
  });

  test("Owner sees Leadership Team link", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("link", { name: /leadership team/i })
    ).toBeVisible();
  });

  test("navigation cards are clickable", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);

    // Click on Members card
    const membersLink = page.getByRole("link", { name: /members|roster/i });
    await membersLink.click();

    await expect(page).toHaveURL(/\/members/);
  });
});

test.describe("Dashboard Role-Based Navigation", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;

  test("Viewer does NOT see Metrics Library link", async ({ page }) => {
    test.skip(
      !testAllianceId ||
        !process.env.TEST_VIEWER_EMAIL ||
        !process.env.TEST_VIEWER_PASSWORD,
      "Viewer credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("link", { name: /metrics library/i })
    ).not.toBeVisible();
  });

  test("Viewer does NOT see Evaluation Periods link", async ({ page }) => {
    test.skip(
      !testAllianceId ||
        !process.env.TEST_VIEWER_EMAIL ||
        !process.env.TEST_VIEWER_PASSWORD,
      "Viewer credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("link", { name: /evaluation periods/i })
    ).not.toBeVisible();
  });

  test("Viewer does NOT see Leadership Team link", async ({ page }) => {
    test.skip(
      !testAllianceId ||
        !process.env.TEST_VIEWER_EMAIL ||
        !process.env.TEST_VIEWER_PASSWORD,
      "Viewer credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}`);

    await expect(
      page.getByRole("link", { name: /leadership team/i })
    ).not.toBeVisible();
  });
});
