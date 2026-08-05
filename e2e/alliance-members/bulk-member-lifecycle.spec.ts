import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11yLevelAA } from "../shared/accessibility";

/**
 * Bulk Member Lifecycle E2E Tests (#277 PR 2)
 *
 * Route-level evidence for selection + bulk archive/restore on the main
 * Members page: one intent per view (Active -> Archive, Archived -> Restore,
 * All -> browse-only), the real confirmation dialog, atomic capacity
 * enforcement, and honest result summaries.
 */
test.describe("Bulk Member Lifecycle", () => {
  test("selects and bulk-archives active members, showing an honest result summary and removing them from the Active view", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "BulkArchiveHero" },
        { allianceId, playerName: "BulkArchiveWarrior" },
        { allianceId, playerName: "BulkArchiveBystander" },
      ],
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    await page.getByRole("checkbox", { name: "Select BulkArchiveHero" }).check();
    await page.getByRole("checkbox", { name: "Select BulkArchiveWarrior" }).check();

    await page.getByRole("button", { name: "Archive selected" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Archive 2 members?")).toBeVisible();
    await expect(dialog.getByText("They will leave the active roster.")).toBeVisible();
    await expect(
      dialog.getByText("Metrics, notes, invitations, linked accounts, and history will be preserved.")
    ).toBeVisible();
    await expect(dialog.getByText("BulkArchiveHero, BulkArchiveWarrior")).toBeVisible();

    await dialog.getByRole("button", { name: "Archive 2 members" }).click();

    await expect(page.getByText("Archived 2 members.")).toBeVisible();
    await expect(page.getByText("BulkArchiveHero")).not.toBeVisible();
    await expect(page.getByText("BulkArchiveWarrior")).not.toBeVisible();
    await expect(page.getByText("BulkArchiveBystander")).toBeVisible();
  });

  test("selects and bulk-restores archived members, showing the capacity impact and an honest result summary", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "BulkRestoreActive1" },
        { allianceId, playerName: "BulkRestoreActive2" },
      ],
    });
    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "BulkRestoreArchived1", archivedAt: new Date() },
        { allianceId, playerName: "BulkRestoreArchived2", archivedAt: new Date() },
      ],
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=archived`);

    await page.getByRole("checkbox", { name: "Select all archived members" }).check();
    await page.getByRole("button", { name: "Restore selected" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Restore 2 members?")).toBeVisible();
    await expect(dialog.getByText("Active roster: 2 → 4; 96 spaces remaining.")).toBeVisible();

    await dialog.getByRole("button", { name: "Restore 2 members" }).click();

    await expect(page.getByText("Restored 2 members.")).toBeVisible();

    await page.goto(`/alliances/${allianceId}/members?filter=active`);
    await expect(page.getByText("BulkRestoreArchived1")).toBeVisible();
    await expect(page.getByText("BulkRestoreArchived2")).toBeVisible();
  });

  test("atomically rejects a bulk restore that exceeds capacity: confirm stays disabled and nobody is restored", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    // 99 active -> only 1 space remains for a 5-member restore selection.
    await prisma.allianceMember.createMany({
      data: Array.from({ length: 99 }, (_, i) => ({
        allianceId,
        playerName: `CapacityActive${i + 1}`,
      })),
    });
    await prisma.allianceMember.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        allianceId,
        playerName: `CapacityArchived${i + 1}`,
        archivedAt: new Date(),
      })),
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=archived`);

    await page.getByRole("checkbox", { name: "Select all archived members" }).check();
    await page.getByRole("button", { name: "Restore selected" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Your alliance has 99 active members, so you can restore 1 more.")
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Restore 5 members" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Cancel" }).click();

    const stillArchivedCount = await prisma.allianceMember.count({
      where: { allianceId, archivedAt: { not: null } },
    });
    expect(stillArchivedCount).toBe(5);
  });

  test("the All view is browse-only — no bulk selection UI even for a manager", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "AllViewMember" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=all`);

    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test("a Leader (no MANAGE_MEMBERS) never sees bulk selection UI", async ({
    page,
    login,
    leaderScenario,
  }) => {
    const { allianceId, email, password } = leaderScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "LeaderViewMember" },
    });

    await login({ email, password, displayName: "Leader User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    await expect(page.getByText("LeaderViewMember")).toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test("Escape closes the confirmation dialog without archiving anyone", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "EscapeCancelMember" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    await page.getByRole("checkbox", { name: "Select EscapeCancelMember" }).check();
    await page.getByRole("button", { name: "Archive selected" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    const member = await prisma.allianceMember.findFirst({
      where: { allianceId, playerName: "EscapeCancelMember" },
    });
    expect(member?.archivedAt).toBeNull();
  });

  test("@a11y bulk archive confirmation dialog meets accessibility standards", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "A11yBulkMember" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);
    await page.waitForLoadState("networkidle");
    await checkA11yLevelAA(page);

    await page.getByRole("checkbox", { name: "Select A11yBulkMember" }).check();
    await page.getByRole("button", { name: "Archive selected" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await checkA11yLevelAA(page);
  });

  test("the bulk action bar and confirmation dialog add no horizontal overflow of their own at a 320px viewport", async ({
    page,
    login,
    adminScenario,
  }) => {
    // Scoped to what PR 2 owns: selecting a row, opening the bulk bar, and
    // opening the confirmation dialog must not make the page any wider than
    // it already is. This intentionally does NOT assert a page-wide "no
    // horizontal scroll" invariant — the Members page header's action-button
    // row (Import Members / Import history / Add Member) already overflows
    // at 320px whenever the alliance has members, independent of anything
    // here; that's a pre-existing bug outside PR 2's scope.
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "MobileBulkMemberWithAVeryLongDisplayName" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);
    await page.waitForLoadState("networkidle");

    const scrollWidthBefore = await page.evaluate(() => document.documentElement.scrollWidth);

    await page.getByRole("checkbox", { name: "Select MobileBulkMemberWithAVeryLongDisplayName" }).check();
    const scrollWidthWithBulkBar = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidthWithBulkBar).toBeLessThanOrEqual(scrollWidthBefore);

    await page.getByRole("button", { name: "Archive selected" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const scrollWidthWithDialog = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidthWithDialog).toBeLessThanOrEqual(scrollWidthBefore);

    // The dialog itself must fit the viewport and wrap the long name rather
    // than forcing its own box wider than 320px.
    const dialogBox = await page.getByRole("dialog").boundingBox();
    expect(dialogBox?.width).toBeLessThanOrEqual(320);
  });
});
