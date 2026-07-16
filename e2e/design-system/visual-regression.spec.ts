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

    // Clip to the stable top chrome (breadcrumb, header, filter tabs, column
    // headers) and mask the data-dependent parts: the member table rows and
    // the "N members" count both change as other CRUD tests create members.
    // A full-page capture is non-deterministic for the same reason.
    // The small maxDiffPixelRatio absorbs the changing filter-tab count digits
    // while still catching design-wide regressions (which recolor the clip).
    await expect(page).toHaveScreenshot("members-table.png", {
      clip: { x: 0, y: 0, width: 1280, height: 320 },
      animations: "disabled",
      mask: [
        page.getByRole("table"),
        page.getByText(/\d+ members/i),
      ],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("@visual Member Detail visual snapshot", async ({ page }) => {
    test.skip(!testMemberId, "TEST_MEMBER_ID required");

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);
    await page.waitForLoadState("networkidle");

    // Clip to the stable header region and mask the member name, which other
    // CRUD tests rename. The notes list length is also data-dependent, so we
    // avoid a full-page capture here. The small maxDiffPixelRatio absorbs any
    // residual data churn while still catching design-wide regressions.
    await expect(page).toHaveScreenshot("member-detail.png", {
      clip: { x: 0, y: 0, width: 1280, height: 360 },
      animations: "disabled",
      mask: [
        page.getByLabel("Breadcrumb"),
        page.getByRole("heading", { level: 1 }),
        page.locator("h2").first(),
      ],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("@visual Metrics Library visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/metrics`);
    await page.waitForLoadState("networkidle");

    // Clip to the stable top chrome (header + "Create Metric" card). The metric
    // list below grows as other CRUD tests create metrics (which are archived,
    // not deleted), so a full-page capture is non-deterministic. Mask any card
    // name headings and allow a small diff for residual churn.
    await expect(page).toHaveScreenshot("metrics-library.png", {
      clip: { x: 0, y: 0, width: 1280, height: 210 },
      animations: "disabled",
      mask: [page.locator("h2")],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("@visual Evaluation Periods visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/periods`);
    await page.waitForLoadState("networkidle");

    // Clip to the stable top chrome (header + "Create Period" card). The period
    // list below grows as other CRUD tests create periods, so a full-page
    // capture is non-deterministic. Mask any card name headings and allow a
    // small diff for residual churn.
    await expect(page).toHaveScreenshot("evaluation-periods.png", {
      clip: { x: 0, y: 0, width: 1280, height: 210 },
      animations: "disabled",
      mask: [page.locator("h2")],
      maxDiffPixelRatio: 0.02,
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
