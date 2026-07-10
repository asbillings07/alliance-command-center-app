import { test, expect } from "../shared/fixtures";

/**
 * Visual Regression E2E Tests
 *
 * Uses Playwright screenshots to catch accidental CSS regressions.
 * Run with: npm run test:visual
 *
 * @tags @visual
 */
test.describe("Visual Regression", () => {
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

  test("@visual Dashboard visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("dashboard.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Members Table visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("members-table.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Member Detail visual snapshot", async ({ page }) => {
    test.skip(!testMemberId, "TEST_MEMBER_ID required");

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("member-detail.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Metrics Library visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/metrics`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("metrics-library.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Evaluation Periods visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/periods`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("evaluation-periods.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Setup Page visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/setup`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("setup-page.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("Design System Preview", () => {
  test("@visual Design System page visual snapshot", async ({ page }) => {
    await page.goto("/design-system");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("design-system.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("Auth Pages Visual", () => {
  test("@visual Login page visual snapshot", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("login.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Beta redeem page visual snapshot", async ({ page }) => {
    await page.goto("/redeem");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("redeem.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Invite page visual snapshot", async ({ page }) => {
    await page.goto("/invite");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("invite.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
