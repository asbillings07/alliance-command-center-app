import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11yWithOptions } from "../shared/accessibility";
import { renderCollaboratorInvitationEmail } from "@/app/src/lib/email/templates/collaboratorInvitationEmail";

for (const width of [390, 820, 1280]) {
  test(`invitation creation and resend report skipped mail honestly at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, email, password } = ownerScenario;
    const recipient = `invite-${allianceId}@example.com`;
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Owner" });
    await page.goto(`/alliances/${allianceId}/settings/invitations`);
    await page.getByLabel("Player Name", { exact: true }).fill("Jordan Vale");
    await page.getByRole("button", { name: 'Create new member "Jordan Vale"' }).click();
    await page.getByLabel("Email", { exact: true }).fill(recipient);
    await page.getByRole("button", { name: "Send Invitation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Invitation created", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("No email was sent");
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { allianceId, email: recipient } });
    expect(invitation.acceptedAt).toBeNull();
    await checkA11yWithOptions(page, { include: ['[role="status"]'] });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`invitation-created-${width}.png`), fullPage: true });
    // No reload: creation and pending results must not disagree after renewal.
    await page.getByRole("button", { name: "Resend", exact: true }).click();
    await expect(page.getByText("Invitation renewed", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invitation created", exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("No email was sent");
    await expect(page.getByText("The previous link and code have been replaced.")).toBeVisible();
    const renewed = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(renewed.token).not.toBe(invitation.token);
    expect(await prisma.invitation.count({ where: { allianceId, email: recipient } })).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`invitation-renewed-${width}.png`), fullPage: true });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
    await expect(page.getByText("Invitation renewed", { exact: true })).toHaveCount(0);
    if (width === 390) {
      await page.getByLabel("Player Name", { exact: true }).fill("Taylor Reed");
      await page.getByRole("button", { name: 'Create new member "Taylor Reed"' }).click();
      await page.getByLabel("Email", { exact: true }).fill(`second-${allianceId}@example.com`);
      await page.getByRole("button", { name: "Send Invitation", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Invitation created", exact: true })).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Invitation created", exact: true })).toHaveCount(0);
    }
  });
}

test("collaborator email is readable on a phone and a desktop", async ({ page }, testInfo) => {
  const email = renderCollaboratorInvitationEmail({ id: "synthetic", allianceName: "Aurora Alliance", playerName: "Jordan Vale", role: "LEADER", inviteUrl: "https://example.com/invite/qa-only", inviteCode: "ABC-DEF-GHJ", expiresAt: new Date("2026-12-01T18:00:00Z") });
  // Render the real template with synthetic data; no provider and no real sends.
  for (const width of [320, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(email.html)}`);
    await expect(page.getByRole("link", { name: "Review invitation", exact: true })).toHaveAttribute("href", "https://example.com/invite/qa-only");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`collaborator-email-${width}.png`), fullPage: true });
  }
});
