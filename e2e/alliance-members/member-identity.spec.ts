import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y, checkA11yWithOptions } from "../shared/accessibility";

for (const width of [320, 820, 1280]) {
  test(`owner reviews, confirms and revokes member identity at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId } });
    const href = `/alliances/${allianceId}/members/${member.id}/identity`;
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Owner" });
    await page.goto(`/alliances/${allianceId}/members/${member.id}`);
    await page.getByRole("link", { name: "Review member identity", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Member identity", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm identity", exact: true })).toBeDisabled();
    await checkA11y(page);
    await page.screenshot({ path: testInfo.outputPath(`identity-review-${width}.png`), fullPage: true });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm identity", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("does not change account permissions");
    await checkA11yWithOptions(page, { include: ["dialog[open]"] });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await prisma.memberIdentityDecision.count({ where: { memberId: member.id } })).toBe(0);
    await expect(page.getByRole("button", { name: "Confirm identity", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Confirm identity", exact: true }).click();
    await dialog.getByRole("button", { name: "Yes, confirm identity" }).click();
    await expect(page.getByText("Identity confirmed", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Identity confirmed", { exact: true })).toBeVisible();
    expect(await prisma.memberIdentityDecision.count({ where: { memberId: member.id } })).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`identity-confirmed-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Revoke confirmation", exact: true }).click();
    await dialog.getByRole("button", { name: "Yes, revoke confirmation" }).click();
    await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
    await page.reload();
    expect(await prisma.memberIdentityDecision.count({ where: { memberId: member.id } })).toBe(2);
    await expect(page.getByRole("region", { name: "Identity decision history" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm identity", exact: true }).click();
    await prisma.allianceMember.update({ where: { id: member.id }, data: { playerName: "Jordan Renamed" } });
    await dialog.getByRole("button", { name: "Yes, confirm identity" }).click();
    await expect(dialog.getByRole("alert")).toContainText("changed");
    expect(await prisma.memberIdentityDecision.count({ where: { memberId: member.id } })).toBe(2);
    await page.goto(href);
    await expect(page.getByText("Jordan Renamed", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("read-only collaborators cannot review identity and missing links cannot be confirmed", async ({ page, login, ownerScenario }) => {
  const { allianceId, userId, email, password } = ownerScenario;
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Unlinked Member" } });
  const href = `/alliances/${allianceId}/members/${member.id}/identity`;
  await login({ email, password, displayName: "Owner" });
  await page.goto(href);
  await expect(page.getByText("No linked account", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm identity", exact: true })).toHaveCount(0);
  await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "VIEWER" } });
  await page.goto(href);
  await expect(page).not.toHaveURL(/\/identity$/);
  await expect(page.getByRole("heading", { name: "Member identity", exact: true })).toHaveCount(0);
});
