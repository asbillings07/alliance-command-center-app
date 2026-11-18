import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y, checkA11yWithOptions } from "../shared/accessibility";

async function confirm(allianceId: string, memberId: string, actorId: string) {
  // Fixture setup only: the browser exercises the separate access decision.
  const member = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId }, include: { alliance: true } });
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  await prisma.memberIdentityDecision.create({ data: { allianceId, memberId, confirmed: true,
    accountUserId: member.userId, playerName: member.playerName, allianceName: member.alliance.name,
    server: member.alliance.server, memberVersion: member.identityVersion, allianceVersion: member.alliance.identityVersion,
    actorUserId: actorId, actorName: actor.displayName, actorRole: "OWNER" } });
}

for (const width of [320, 820, 1280]) {
  test(`explicit member access, ordinary-member boundary and revocation at ${width}px`, async ({ page, browser, login, ownerScenario }, testInfo) => {
    test.setTimeout(180000);
    const { allianceId, userId, email, password } = ownerScenario;
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const account = await prisma.user.create({ data: { email: `ordinary-${crypto.randomUUID()}@example.test`, displayName: "Jordan Account", passwordHash: owner.passwordHash } });
    const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId: account.id } });
    const other = await prisma.allianceMember.create({ data: { allianceId, playerName: "Leadership-only Player" } });
    const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height: 900 } });
    try {
      await page.setViewportSize({ width, height: 900 });
      await login({ email, password, displayName: "Owner" });
      await page.goto(`/alliances/${allianceId}/members/${member.id}`);
      await expect(page.getByText("Account Linked", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Manage member access" }).click();
      await expect(page.getByRole("heading", { name: "Member access", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve member access", exact: true })).toHaveCount(0);
      await expect(page.getByText("Confirm the current member identity before approving access.")).toBeVisible();
      await confirm(allianceId, member.id, userId); await page.reload();
      await page.getByRole("button", { name: "Approve member access", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(account.email);
      await expect(dialog).toContainText("Jordan Vale");
      await checkA11yWithOptions(page, { include: ["dialog[open]"] });
      await page.screenshot({ path: testInfo.outputPath(`access-warning-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name: "Approve member access", exact: true })).toBeFocused();
      expect(await prisma.memberSelfAccessDecision.count({ where: { memberId: member.id } })).toBe(0);
      await page.getByRole("button", { name: "Approve member access", exact: true }).click();
      await dialog.getByRole("button", { name: "Yes, approve member access" }).click();
      await expect(page.getByText("Member access approved", { exact: true })).toBeVisible();
      await page.reload();
      await checkA11y(page);
      await page.screenshot({ path: testInfo.outputPath(`access-approved-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await prisma.allianceMembership.count({ where: { allianceId, userId: account.id } })).toBe(0);
      const memberPage = await memberContext.newPage();
      await memberPage.goto("/login");
      await memberPage.locator('input[name="email"]').fill(account.email);
      await memberPage.locator('input[name="password"]').fill(password);
      await memberPage.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(memberPage).toHaveURL(new RegExp(`/alliances/${allianceId}/my-record$`));
      await expect(memberPage.getByRole("heading", { name: "Your identity" })).toBeVisible();
      await expect(memberPage.getByText("Jordan Vale", { exact: true })).toBeVisible();
      await expect(memberPage.getByRole("button", { name: "Screenshot uploads unavailable" })).toBeDisabled();
      await checkA11y(memberPage);
      await memberPage.screenshot({ path: testInfo.outputPath(`own-record-${width}.png`), fullPage: true });
      expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await memberPage.goto(`/alliances/${allianceId}/my-record?memberId=${other.id}`);
      await expect(memberPage.getByText("Jordan Vale", { exact: true })).toBeVisible();
      await expect(memberPage.locator("body")).not.toContainText("Leadership-only Player");
      for (const path of ["members", `members/${other.id}`, `members/${member.id}/identity`, `members/${member.id}/access`, "reports", "settings/invitations"]) {
        await memberPage.goto(`/alliances/${allianceId}/${path}`).catch(error => {
          // Next's streamed authorization redirect may replace the navigation.
          if (!String(error).includes("net::ERR_ABORTED")) throw error;
        });
        await expect(memberPage).toHaveURL(new RegExp(`/alliances/${allianceId}/my-record$`));
        await expect(memberPage.getByRole("heading", { name: "Your identity" })).toBeVisible();
        await expect(memberPage.locator("body")).not.toContainText("Leadership-only Player");
      }
      await memberPage.goto("/alliances/unrelated-alliance/my-record");
      await expect(memberPage.getByRole("heading", { name: "Member access is unavailable" })).toBeVisible();
      await memberPage.goto("/account");
      await memberPage.getByRole("link", { name: "My member records" }).click();
      await expect(memberPage.getByRole("link", { name: "Open my member record" })).toHaveCount(1);
      await page.bringToFront();
      await page.getByRole("button", { name: "Revoke member access", exact: true }).click();
      await expect(dialog).toContainText("Their next request");
      await dialog.getByRole("button", { name: "Yes, revoke member access" }).click();
      await expect(page.getByText("Not approved", { exact: true })).toBeVisible();
      await memberPage.goto(`/alliances/${allianceId}/my-record`);
      await expect(memberPage.getByRole("heading", { name: "Member access is unavailable" })).toBeVisible();
      await expect(memberPage.locator("body")).not.toContainText("Jordan Vale");
      await page.reload();
      await expect(page.getByRole("region", { name: "Access history" }).getByRole("listitem")).toHaveCount(2);
      expect(await prisma.memberSelfAccessDecision.count({ where: { memberId: member.id } })).toBe(2);
    } finally {
      await memberContext.close();
      await prisma.allianceMember.deleteMany({ where: { userId: account.id } });
      await prisma.user.delete({ where: { id: account.id } });
    }
  });
}

test("stale approval is rejected and Leaders cannot grant access", async ({ page, login, ownerScenario }) => {
  const { allianceId, userId, email, password } = ownerScenario;
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId } });
  await confirm(allianceId, member.id, userId);
  await login({ email, password, displayName: "Owner" });
  const href = `/alliances/${allianceId}/members/${member.id}/access`;
  await page.goto(href);
  await expect(page.getByText(/also has owner collaborator access/)).toBeVisible();
  await page.getByRole("button", { name: "Approve member access", exact: true }).click();
  await prisma.allianceMember.update({ where: { id: member.id }, data: { playerName: "Changed Name" } });
  await page.getByRole("dialog").getByRole("button", { name: "Yes, approve member access" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("changed");
  expect(await prisma.memberSelfAccessDecision.count({ where: { memberId: member.id } })).toBe(0);
  await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "LEADER" } });
  await page.goto(href);
  await expect(page).not.toHaveURL(/\/access$/);
  await page.goto(`/alliances/${allianceId}/members/${member.id}`);
  await expect(page.getByRole("link", { name: "Manage member access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review member identity" })).toBeVisible();
});
