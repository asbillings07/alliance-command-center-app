import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11yWithOptions } from "../shared/accessibility";

// Visibility alone accepts controls outside a horizontal scroll container.
async function expectHorizontallyAccessible(control: Locator) {
  await expect(control).toBeVisible();
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (box.left < 0 || box.right > window.innerWidth) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowX)) {
        const bounds = parent.getBoundingClientRect();
        if (box.left < bounds.left || box.right > bounds.right) return false;
      }
    }
    return true;
  })).toBe(true);
}

for (const width of [320, 820, 1280]) {
  test(`pending invitation controls remain reachable and revoke only the selected invite at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    const recipient = "a-very-long-invited-player-email-for-responsive-testing@example.com";
    const playerName = "AReallyLongUnbrokenPlayerNameForResponsiveTesting";
    const invitation = await prisma.invitation.create({ data: {
      allianceId, invitedById: userId, email: recipient, playerNameSnapshot: playerName,
      membershipRole: "VIEWER", token: randomUUID(), code: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
    } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Owner" });
    await page.waitForURL(/\/alliances\/[^/]+/);
    await page.goto(`/alliances/${allianceId}/settings/invitations`);
    await page.getByRole("heading", { name: "Pending Invitations", exact: true }).scrollIntoViewIfNeeded();
    const revoke = page.getByRole("button", { name: "Revoke invitation", exact: true });
    const resend = page.getByRole("button", { name: "Resend", exact: true });
    await page.screenshot({ path: testInfo.outputPath(`pending-invitations-${width}.png`), fullPage: true });
    await expectHorizontallyAccessible(resend);
    await expectHorizontallyAccessible(revoke);
    await checkA11yWithOptions(page, { include: ['[aria-label="Pending invitations"]'] });

    // Dismissing the confirmation must leave the existing link usable.
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(recipient);
      expect(dialog.message()).toContain("link and code");
      await dialog.dismiss();
    });
    await revoke.click();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).cancelledAt).toBeNull();

    const other = await prisma.invitation.create({ data: {
      allianceId, invitedById: userId, email: "other@example.com", playerNameSnapshot: "Other Player",
      membershipRole: "VIEWER", token: randomUUID(), code: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
    } });
    // The selected action still targets its original invitation after another is added.
    page.once("dialog", (dialog) => dialog.accept());
    await revoke.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
    await expect(page.getByText("other@example.com", { exact: true })).toBeVisible();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).cancelledAt).not.toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: other.id } })).cancelledAt).toBeNull();
    for (const path of [`/invite/${invitation.token}`, `/invite/code?code=${encodeURIComponent(invitation.code!)}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Invitation Cancelled", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept Invitation", exact: true })).toHaveCount(0);
    }
  });
}
