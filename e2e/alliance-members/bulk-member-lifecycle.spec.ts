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
 *
 * Selection checkboxes are hidden by default — the normal browse state has
 * no selection affordances at all. An explicit entry point ("Archive
 * members…" / "Restore members…") opens a temporary selection mode; Cancel
 * or Escape exits it and returns focus to that entry point.
 */
test.describe("Bulk Member Lifecycle", () => {
  test("default browse state has no selection affordances — only an explicit entry point per view", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "BrowseStateActive" },
        { allianceId, playerName: "BrowseStateArchived", archivedAt: new Date() },
      ],
    });

    await login({ email, password, displayName: "Admin User" });

    await page.goto(`/alliances/${allianceId}/members?filter=active`);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive members…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore members…" })).not.toBeVisible();

    await page.goto(`/alliances/${allianceId}/members?filter=archived`);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore members…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Archive members…" })).not.toBeVisible();
  });

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

    await page.getByRole("button", { name: "Archive members…" }).click();
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

    // Selection mode itself is exited after a successful action — back to
    // the default browse state, not stuck mid-selection.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    const entryButton = page.getByRole("button", { name: "Archive members…" });
    await expect(entryButton).toBeVisible();
    // Selection-mode teardown is deferred until after the dialog's own
    // close() finishes (see MembersTable's succeededRef) specifically so a
    // successful confirm — not just Cancel/Escape — still lands focus
    // somewhere real instead of the browser falling back to <body> because
    // the previously-focused "Archive selected" button was unmounted out
    // from under native <dialog>'s focus-restoration step.
    await expect(entryButton).toBeFocused();
  });

  test("Cancel exits selection mode without archiving anyone, and returns focus to the entry point", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "SelectionCancelMember" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    const entryButton = page.getByRole("button", { name: "Archive members…" });
    await entryButton.click();
    await page.getByRole("checkbox", { name: "Select SelectionCancelMember" }).check();

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(entryButton).toBeFocused();

    const member = await prisma.allianceMember.findFirst({
      where: { allianceId, playerName: "SelectionCancelMember" },
    });
    expect(member?.archivedAt).toBeNull();
  });

  test("Escape exits selection mode (when no dialog is open) and returns focus to the entry point, without archiving anyone", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "SelectionEscapeMember" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    const entryButton = page.getByRole("button", { name: "Archive members…" });
    await entryButton.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("checkbox", { name: "Select SelectionEscapeMember" }).check();

    await page.keyboard.press("Escape");

    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(entryButton).toBeFocused();

    const member = await prisma.allianceMember.findFirst({
      where: { allianceId, playerName: "SelectionEscapeMember" },
    });
    expect(member?.archivedAt).toBeNull();
  });

  test("archiving every displayed active member still shows the honest result summary, alongside the now-empty Active view's empty state", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "LastActiveOne" },
        { allianceId, playerName: "LastActiveTwo" },
      ],
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    await page.getByRole("button", { name: "Archive members…" }).click();
    await page.getByRole("checkbox", { name: "Select all active members" }).check();
    await page.getByRole("button", { name: "Archive selected" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive 2 members" }).click();

    // The result summary must still be visible even though this action
    // emptied the Active view entirely (router.refresh() re-renders with
    // zero active members) — the summary is what confirms the archive
    // actually happened, right when the view has nothing else to show.
    await expect(page.getByText("Archived 2 members.")).toBeVisible();
    await expect(page.getByText("No active members yet")).toBeVisible();
  });

  test("restoring every displayed archived member still shows the honest result summary, alongside the now-empty Archived view's empty state", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "LastArchivedOne", archivedAt: new Date() },
        { allianceId, playerName: "LastArchivedTwo", archivedAt: new Date() },
      ],
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=archived`);

    await page.getByRole("button", { name: "Restore members…" }).click();
    await page.getByRole("checkbox", { name: "Select all archived members" }).check();
    await page.getByRole("button", { name: "Restore selected" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restore 2 members" }).click();

    await expect(page.getByText("Restored 2 members.")).toBeVisible();
    await expect(page.getByText("No archived members")).toBeVisible();
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

    await page.getByRole("button", { name: "Restore members…" }).click();
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

    await page.getByRole("button", { name: "Restore members…" }).click();
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

  test("the All view is browse-only — no bulk selection UI or entry point even for a manager", async ({
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
    await expect(page.getByRole("button", { name: "Archive members…" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Restore members…" })).not.toBeVisible();
  });

  test("a Leader (no MANAGE_MEMBERS) never sees bulk selection UI or an entry point", async ({
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
    await expect(page.getByRole("button", { name: "Archive members…" })).not.toBeVisible();
  });

  test("Escape closes the confirmation dialog without archiving anyone (selection mode and selection remain untouched)", async ({
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

    await page.getByRole("button", { name: "Archive members…" }).click();
    await page.getByRole("checkbox", { name: "Select EscapeCancelMember" }).check();
    await page.getByRole("button", { name: "Archive selected" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // The dialog's own Escape only closes itself — selection mode and the
    // in-progress selection are still intact underneath it.
    await expect(page.getByRole("checkbox", { name: "Select EscapeCancelMember" })).toBeChecked();

    const member = await prisma.allianceMember.findFirst({
      where: { allianceId, playerName: "EscapeCancelMember" },
    });
    expect(member?.archivedAt).toBeNull();
  });

  test("keyboard-only: Enter opens selection mode, Space selects a row, Enter opens the dialog, Tab stays trapped inside it, and Escape returns focus to the triggering button without archiving", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "KeyboardOnlyMember" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);

    // Enter selection mode via keyboard only — no pointer helpers.
    const entryButton = page.getByRole("button", { name: "Archive members…" });
    await entryButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('input[type="checkbox"]')).not.toHaveCount(0);

    const checkbox = page.getByRole("checkbox", { name: "Select KeyboardOnlyMember" });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();

    const archiveButton = page.getByRole("button", { name: "Archive selected" });
    await archiveButton.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Native <dialog>.showModal() moves the browser's focused area into the
    // dialog's subtree (its first tabbable descendant, absent an autofocus
    // attribute).
    const isFocusContained = () =>
      page.evaluate(() => {
        const openDialog = document.querySelector("dialog[open]");
        const active = document.activeElement;
        if (!openDialog || !active) return false;
        // Chromium's native modal-dialog tab cycling can transiently rest
        // focus on <body> itself between the dialog's last and first
        // tabbable elements — <body> is an ancestor of the dialog (so it's
        // never made inert) but isn't a real interactive control, so this
        // isn't a focus "escape" to background content. What must never
        // happen is focus landing on an actual background button/link/input.
        if (active === document.body) return true;
        return openDialog.contains(active);
      });
    expect(await isFocusContained()).toBe(true);

    // Tab all the way around the dialog's two buttons (and then some) —
    // focus must never land on a real background control while the dialog
    // is open, proving real focus containment rather than the jsdom
    // polyfill unit tests rely on.
    const dialogButtonCount = await dialog.getByRole("button").count();
    for (let i = 0; i < dialogButtonCount * 2; i++) {
      await page.keyboard.press("Tab");
      expect(await isFocusContained()).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Focus returns to the control that opened the dialog — native <dialog>
    // return-focus-on-close — not lost to <body>.
    await expect(archiveButton).toBeFocused();

    const member = await prisma.allianceMember.findFirst({
      where: { allianceId, playerName: "KeyboardOnlyMember" },
    });
    expect(member?.archivedAt).toBeNull();
  });

  test("@a11y default browse state, selection mode, and the confirmation dialog all meet accessibility standards", async ({
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

    await page.getByRole("button", { name: "Archive members…" }).click();
    await checkA11yLevelAA(page);

    await page.getByRole("checkbox", { name: "Select A11yBulkMember" }).check();
    await page.getByRole("button", { name: "Archive selected" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await checkA11yLevelAA(page);
  });

  test("the bulk action bar and confirmation dialog stay within a 320px viewport, even with a multi-digit selection count", async ({
    page,
    login,
    adminScenario,
  }) => {
    // Scoped to what PR 2 owns: entering selection mode, the bulk bar, and
    // the confirmation dialog must all fit inside the viewport on their own
    // merits. This intentionally does NOT assert a page-wide "no horizontal
    // scroll" invariant — the Members page header's action-button row
    // (Import Members / Import history / Add Member) already overflows at
    // 320px whenever the alliance has members, independent of anything
    // here; that's a pre-existing bug outside PR 2's scope. Comparing only
    // against that already-overflowing baseline wouldn't catch the bulk bar
    // overflowing further, so this asserts the bar's own box directly.
    const { allianceId, email, password } = adminScenario;

    // 10 members (double-digit selection count: "10 members selected" is
    // meaningfully wider than "1 member selected") plus one long name to
    // exercise the dialog's name-preview wrapping.
    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "MobileBulkMemberWithAVeryLongDisplayName" },
        ...Array.from({ length: 9 }, (_, i) => ({
          allianceId,
          playerName: `MobileBulkMember${i + 1}`,
        })),
      ],
    });

    await login({ email, password, displayName: "Admin User" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/alliances/${allianceId}/members?filter=active`);
    await page.waitForLoadState("networkidle");

    const entryButton = page.getByRole("button", { name: "Archive members…" });
    const entryButtonBox = await entryButton.boundingBox();
    expect(entryButtonBox).not.toBeNull();
    expect(entryButtonBox!.x + entryButtonBox!.width).toBeLessThanOrEqual(320);

    await entryButton.click();
    await page.getByRole("checkbox", { name: "Select all active members" }).check();

    const bulkBar = page.getByTestId("bulk-action-bar");
    await expect(bulkBar.getByText("10 members selected")).toBeVisible();

    // The bar itself, and every control inside it, must stay within the
    // 320px viewport — not merely "no wider than an unrelated, already
    // -overflowing baseline elsewhere on the page".
    const viewportWidth = 320;
    const barBox = await bulkBar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.x).toBeGreaterThanOrEqual(0);
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(viewportWidth);

    for (const button of await bulkBar.getByRole("button").all()) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(viewportWidth);
    }

    await page.getByRole("button", { name: "Archive selected" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The dialog itself must fit the viewport and wrap the long name rather
    // than forcing its own box wider than 320px.
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewportWidth);
  });
});
