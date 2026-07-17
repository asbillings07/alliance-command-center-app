import { test } from "../shared/fixtures";
import { checkA11yLevelAA } from "../shared/accessibility";

/**
 * Accessibility E2E Tests
 *
 * Uses axe-core to verify pages meet WCAG 2.1 AA compliance.
 * Run with: npm run test:a11y
 *
 * @tags @a11y
 */
test.describe("Accessibility - Auth Pages", () => {
  test("@a11y Login page meets accessibility standards", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Beta redeem page meets accessibility standards", async ({
    page,
  }) => {
    await page.goto("/redeem");
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Invite page meets accessibility standards", async ({ page }) => {
    await page.goto("/invite");
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });
});

test.describe("Accessibility - Public Pages", () => {
  test("@a11y Design System page meets accessibility standards", async ({
    page,
  }) => {
    await page.goto("/design-system");
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });
});

test.describe("Accessibility - Alliance Pages", () => {
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

  test("@a11y Dashboard meets accessibility standards", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Members Table meets accessibility standards", async ({
    page,
  }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Member Detail meets accessibility standards", async ({
    page,
  }) => {
    test.skip(!testMemberId, "TEST_MEMBER_ID required");

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Metrics Library meets accessibility standards", async ({
    page,
  }) => {
    await page.goto(`/alliances/${testAllianceId}/metrics`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Evaluation Periods meets accessibility standards", async ({
    page,
  }) => {
    await page.goto(`/alliances/${testAllianceId}/periods`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Setup Page meets accessibility standards", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/setup`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Leadership Team settings meets accessibility standards", async ({
    page,
  }) => {
    await page.goto(`/alliances/${testAllianceId}/settings/invitations`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });
});
