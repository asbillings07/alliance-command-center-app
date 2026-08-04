import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";

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
