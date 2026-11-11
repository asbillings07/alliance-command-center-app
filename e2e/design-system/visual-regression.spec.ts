import { test, expect } from "../shared/fixtures";
import { checkA11yLevelAA, checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import type { Page } from "@playwright/test";
import { releaseStage, releaseStageLabels } from "@/app/src/lib/releaseStage";

async function expectReleaseStage(page: Page) {
  const banner = page.getByRole("region", { name: "Release stage", exact: true });
  await expect(banner).toHaveCount(1);
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(releaseStageLabels[releaseStage]);
  const position = await banner.boundingBox();
  expect(position?.y).toBe(0);
}

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
    await expectReleaseStage(page);
  });

  test("@visual Dashboard visual snapshot", async ({ page }, testInfo) => {
    await page.goto(`/alliances/${testAllianceId}`);
    await page.waitForLoadState("networkidle");

    // Retain the exact render for human review even when a subtle color change
    // falls within the screenshot comparator's existing tolerance.
    await testInfo.attach("dashboard-current", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });

    await expect(page).toHaveScreenshot("dashboard.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Mobile dashboard and invitation settings", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, snapshot] of [
      ["", "dashboard-mobile.png"],
      ["/settings/invitations", "invitation-settings-mobile.png"],
    ]) {
      await page.goto(`/alliances/${testAllianceId}${path}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await checkA11yLevelAA(page);
      await testInfo.attach(snapshot, { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
      await expect(page).toHaveScreenshot(snapshot, { fullPage: true, animations: "disabled" });
    }
  });

  test("@visual Members Table visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);
    await page.waitForLoadState("networkidle");

    // Clip to the stable top chrome (breadcrumb, header, filter tabs, period
    // selector, column headers) and mask the data-dependent parts: the member
    // table rows, the "N members" count, and the period selector (option labels
    // vary by seeded period names). A full-page capture is non-deterministic
    // for the same reason. The small maxDiffPixelRatio absorbs the changing
    // filter-tab count digits while still catching design-wide regressions.
    await expect(page).toHaveScreenshot("members-table.png", {
      clip: { x: 0, y: 0, width: 1280, height: 380 },
      animations: "disabled",
      mask: [
        page.getByRole("table"),
        page.getByText(/\d+ members/i),
        page.getByLabel("Evaluation period"),
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

  test("@visual Guided help uses the application palette", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/periods`);
    await page.getByRole("button", { name: "Take a tour" }).click();
    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toHaveScreenshot("guided-help.png", { animations: "disabled" });
    await checkA11yWithOptions(page, { include: [".driver-popover"], runOnly: ["wcag2a", "wcag2aa"] });
    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
  });

  test("@visual Setup Page visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/setup`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("setup-page.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  // No other suite ever writes a MemberImport for the shared TEST_ALLIANCE_ID
  // fixture alliance (roster-import E2E tests all use fresh per-test
  // alliances via adminScenario/leaderScenario), so this empty state is
  // deterministic — no masking needed, matching the Setup Page precedent.
  test("@visual Import History (empty) visual snapshot", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/imports`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("import-history-empty.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("@visual Import History Detail visual snapshot", async ({ page }) => {
    // Self-seeded and cleaned up within this test (same pattern as
    // metric-report.spec.ts) so the shared alliance's Import History (empty)
    // snapshot above stays deterministic for other test runs.
    const suffix = `${Date.now()}`;
    const member = await prisma.allianceMember.create({
      data: {
        allianceId: testAllianceId!,
        playerName: `Visual Import Member ${suffix}`,
        thp: 50000,
      },
    });
    const memberImport = await prisma.memberImport.create({
      data: {
        allianceId: testAllianceId!,
        actorEmailSnapshot: "visual-test@example.test",
        actorDisplayNameSnapshot: "Visual Test Actor",
        fileName: "visual-roster.xlsx",
        sourceSheetName: "Roster",
        createdCount: 1,
        restoredCount: 0,
        skippedExistingCount: 0,
        skippedDuplicateCount: 0,
        skippedEmptyNameCount: 0,
        skippedUnselectedCount: 0,
        changes: {
          create: [
            {
              allianceMemberId: member.id,
              playerNameSnapshot: member.playerName,
              sourceRow: 1,
              changeType: MemberImportChangeType.CREATED,
              thpAfter: member.thp,
              memberUpdatedAtAfter: member.updatedAt,
            },
          ],
        },
      },
    });

    try {
      await page.goto(`/alliances/${testAllianceId}/members/imports/${memberImport.id}`);
      await page.waitForLoadState("networkidle");

      // Mask everything that varies per run: the title/breadcrumb (file
      // name), the "Imported by ... on ..." description, and the player
      // name link — the stable page chrome and card/table structure stay in
      // the diff.
      await expect(page).toHaveScreenshot("import-history-detail.png", {
        fullPage: true,
        animations: "disabled",
        mask: [
          page.getByRole("heading", { level: 1 }),
          page.locator("p.text-text-muted").first(),
          page.getByRole("link", { name: member.playerName }),
        ],
        maxDiffPixelRatio: 0.02,
      });
    } finally {
      await prisma.memberImportChange.deleteMany({ where: { memberImportId: memberImport.id } });
      await prisma.memberImport.delete({ where: { id: memberImport.id } });
      await prisma.allianceMember.delete({ where: { id: member.id } });
    }
  });
});

test.describe("Design System Preview", () => {
  test("@visual Design System page visual snapshot", async ({ page }) => {
    await page.goto("/design-system");
    await page.waitForLoadState("networkidle");
    await expectReleaseStage(page);

    await expect(page).toHaveScreenshot("design-system.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("Auth Pages Visual", () => {
  test("@visual Release stage covers public and standalone pages on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expectReleaseStage(page);
    await expect(page).toHaveScreenshot("welcome-release-stage.png", { fullPage: true, animations: "disabled" });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectReleaseStage(page);

    await page.setViewportSize({ width: 320, height: 780 });
    for (const path of ["/", "/login", "/invite/invalid-release-stage", "/redeem/invalid-release-stage", "/account/email/verify/invalid-release-stage", "/missing-release-stage-page"]) {
      await page.goto(path);
      await expectReleaseStage(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await checkA11yWithOptions(page, { include: ['[aria-label="Release stage"]'], runOnly: ["wcag2a", "wcag2aa"] });
      if (path === "/") {
        await expect(page).toHaveScreenshot("welcome-release-stage-mobile.png", { fullPage: true, animations: "disabled" });
      }
    }
  });

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

// The platform console has a different shell from alliance pages. Capture both
// shells explicitly so a welcome-page-only refresh cannot conceal this gap.
test.describe("Platform brand coverage", () => {
  test("@visual Platform navigation desktop and mobile", async ({ page }) => {
    test.skip(!process.env.TEST_PLATFORM_ADMIN_EMAIL || !process.env.TEST_PLATFORM_ADMIN_PASSWORD,
      "Platform test credentials required");
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_PLATFORM_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances|platform)/);
    await page.goto("/platform/overview");
    await page.waitForLoadState("networkidle");
    await expectReleaseStage(page);
    await expect(page.locator("header")).toHaveScreenshot("platform-header.png", { animations: "disabled" });
    // Capture the navigation itself, not time-sensitive operational data.
    await expect(page.locator("aside nav ul")).toHaveScreenshot("platform-navigation.png", { animations: "disabled" });
    await checkA11yLevelAA(page);

    await page.setViewportSize({ width: 320, height: 780 });
    await expectReleaseStage(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expect(page.locator("header")).toHaveScreenshot("platform-header-mobile.png", { animations: "disabled" });
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.locator("div.fixed").filter({ has: page.getByRole("button", { name: "Close navigation menu" }) });
    await expect(drawer).toHaveScreenshot("platform-navigation-mobile.png", { animations: "disabled" });
    await checkA11yLevelAA(page);
    await page.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(page.getByRole("button", { name: "Close navigation menu" })).not.toBeVisible();
  });
});
