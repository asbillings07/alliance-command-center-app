import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import { checkA11yLevelAA } from "../shared/accessibility";

/**
 * Import History E2E Tests (#277 PR 1)
 *
 * Route-level evidence for the new /members/imports (list) and
 * /members/imports/[importId] (detail) pages, and the completion-step
 * "View import details" link that bridges the upload workflow into history.
 * Each test seeds its own alliance via `adminScenario`, whose fixture
 * teardown already clears MemberImportChange/MemberImport rows
 * (onDelete: Restrict) before the alliance itself.
 */
test.describe("Import History", () => {
  test("completing a roster import links directly to the import's detail page", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });

    await page.goto(`/alliances/${allianceId}/members/import`);
    await expect(page.getByRole("heading", { name: "Member Import" })).toBeVisible();

    const csvContent = `Player,THP,Role\nHistoryNavHero,450000000,R4`;
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "history-nav-roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    const importBtn = page.getByRole("button", { name: /Import .* Member/i });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    await expect(page.getByText("Committed Alliance Member Translation")).toBeVisible();

    const detailLink = page.getByRole("link", { name: "View import details" });
    await expect(detailLink).toBeVisible();
    await detailLink.click();

    await page.waitForURL(new RegExp(`/alliances/${allianceId}/members/imports/[^/]+$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "history-nav-roster.csv" })
    ).toBeVisible();
    await expect(page.getByText("HistoryNavHero")).toBeVisible();
    await expect(page.getByRole("link", { name: "Import history", exact: true })).toBeVisible();
  });

  test("import history list page shows a completed import and navigates to its detail page", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    const member = await prisma.allianceMember.create({
      data: { allianceId, playerName: "ListPageSeededMember", thp: 12345 },
    });
    const memberImport = await prisma.memberImport.create({
      data: {
        allianceId,
        actorEmailSnapshot: "seed-actor@example.test",
        actorDisplayNameSnapshot: "Seed Actor",
        fileName: "list-page-roster.xlsx",
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

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members/imports`);

    await expect(page.getByRole("heading", { level: 1, name: "Import History" })).toBeVisible();
    await expect(page.getByText("list-page-roster.xlsx")).toBeVisible();
    await expect(page.getByText("Seed Actor")).toBeVisible();

    await page
      .getByRole("link", { name: `list-page-roster.xlsx created ${memberImport.createdCount}` })
      .click();

    await page.waitForURL(new RegExp(`/members/imports/${memberImport.id}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "list-page-roster.xlsx" })
    ).toBeVisible();
    await expect(page.getByText("ListPageSeededMember")).toBeVisible();
  });

  test("@a11y Import History empty state meets accessibility standards", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members/imports`);
    await page.waitForLoadState("networkidle");

    await checkA11yLevelAA(page);
  });

  test("@a11y Import History list and detail pages meet accessibility standards", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    // A RESTORED change (with a real before/after THP + role diff) exercises
    // the accessible from/to markup that plain-styling strikethrough alone
    // wouldn't convey to axe / a screen reader.
    const archivedMember = await prisma.allianceMember.create({
      data: {
        allianceId,
        playerName: "A11yRestoredMember",
        thp: 10000,
        role: "R2",
        archivedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const restoredMember = await prisma.allianceMember.update({
      where: { id: archivedMember.id },
      data: { archivedAt: null, thp: 20000, role: "R3" },
    });
    const memberImport = await prisma.memberImport.create({
      data: {
        allianceId,
        actorEmailSnapshot: "a11y-actor@example.test",
        actorDisplayNameSnapshot: "A11y Actor",
        fileName: "a11y-roster.xlsx",
        sourceSheetName: "Roster",
        createdCount: 0,
        restoredCount: 1,
        skippedExistingCount: 0,
        skippedDuplicateCount: 0,
        skippedEmptyNameCount: 0,
        skippedUnselectedCount: 0,
        changes: {
          create: [
            {
              allianceMemberId: restoredMember.id,
              playerNameSnapshot: restoredMember.playerName,
              sourceRow: 1,
              changeType: MemberImportChangeType.RESTORED,
              archivedAtBefore: new Date("2026-01-01T00:00:00Z"),
              archivedAtAfter: null,
              thpBefore: 10000,
              thpAfter: 20000,
              roleBefore: "R2",
              roleAfter: "R3",
              memberUpdatedAtAfter: restoredMember.updatedAt,
            },
          ],
        },
      },
    });

    await login({ email, password, displayName: "Admin User" });

    await page.goto(`/alliances/${allianceId}/members/imports`);
    await page.waitForLoadState("networkidle");
    await checkA11yLevelAA(page);

    await page.goto(`/alliances/${allianceId}/members/imports/${memberImport.id}`);
    await page.waitForLoadState("networkidle");
    await checkA11yLevelAA(page);
  });

  test("renders the import history list and detail pages at a 320px viewport without horizontal overflow", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    const member = await prisma.allianceMember.create({
      data: {
        allianceId,
        playerName: "MobileOverflowCheckMemberWithAVeryLongDisplayName",
        thp: 999999999,
        role: "R5",
      },
    });
    const memberImport = await prisma.memberImport.create({
      data: {
        allianceId,
        actorEmailSnapshot: "mobile-actor@example.test",
        actorDisplayNameSnapshot: "Mobile Test Actor With A Fairly Long Display Name",
        fileName: "a-fairly-long-roster-filename-for-mobile-testing.xlsx",
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
              roleAfter: member.role,
              memberUpdatedAtAfter: member.updatedAt,
            },
          ],
        },
      },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.setViewportSize({ width: 320, height: 800 });

    for (const path of [
      `/alliances/${allianceId}/members/imports`,
      `/alliances/${allianceId}/members/imports/${memberImport.id}`,
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // A bounding-box check on any single element can't detect page- or
      // descendant-level horizontal overflow. Comparing the *document's*
      // scrollWidth to the viewport width is what actually proves nothing
      // on the page forces horizontal scroll at this width (matches
      // metric-report.spec.ts's equivalent 320px check).
      const { docScrollWidth, viewportWidth } = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(docScrollWidth).toBeLessThanOrEqual(viewportWidth);
    }
  });
});
