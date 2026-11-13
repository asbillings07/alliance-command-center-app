import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y } from "../shared/accessibility";

for (const width of [390, 820]) {
  test(`platform support recovers an account without email at ${width}px`, async ({ page, context, browser, login, ownerScenario, betaUser }, testInfo) => {
    test.setTimeout(120000);
    const actor = ownerScenario;
    await prisma.user.update({ where: { id: actor.userId }, data: { isPlatformAdmin: true, displayName: "Morgan Support" } });
    await prisma.user.update({ where: { id: betaUser.userId }, data: { displayName: "Taylor Member" } });
    try {
      await page.setViewportSize({ width, height: 900 });
      await login({ email: actor.email, password: actor.password, displayName: "Morgan Support" });
      await page.goto("/platform/overview");
      await page.getByRole("link", { name: "Recover account access →", exact: true }).click();
      await page.getByLabel("Account email", { exact: true }).fill(betaUser.email);
      await page.getByRole("button", { name: "Find account", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Taylor Member" })).toBeVisible();
      await checkA11y(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`password-recovery-${width}.png`), fullPage: true });
      await page.getByRole("checkbox").check();
      await page.getByLabel("Your administrator password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Create recovery link", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Your password could not be verified" })).toBeVisible();
      expect(await prisma.passwordResetToken.count({ where: { userId: betaUser.userId } })).toBe(0);
      await page.getByLabel("Your administrator password", { exact: true }).fill(actor.password);
      await page.getByRole("button", { name: "Create recovery link", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Recovery link ready" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Recovery link ready" })).toBeFocused();
      await expect(page.getByText("Created by Morgan Support", { exact: true })).toBeVisible();
      const resetUrl = await page.getByLabel("Private recovery link", { exact: true }).inputValue();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "Copy recovery link", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Recovery link copied");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(resetUrl);
      await checkA11y(page);
      // A real signed-in recipient session must be revoked by completing recovery.
      const recipientContext = await browser.newContext();
      const recipient = await recipientContext.newPage();
      await recipient.goto("http://localhost:3000/login");
      await recipient.locator('input[name="email"]').fill(betaUser.email);
      await recipient.locator('input[name="password"]').fill(betaUser.password);
      await recipient.getByRole("button", { name: "Sign In", exact: true }).click();
      await recipient.waitForURL(/create-alliance/);
      const resetContext = await browser.newContext();
      const resetPage = await resetContext.newPage();
      await resetPage.goto(resetUrl);
      await resetPage.getByLabel("New Password", { exact: true }).fill("new-owner-passphrase");
      await resetPage.getByLabel("Confirm New Password", { exact: true }).fill("new-owner-passphrase");
      await resetPage.getByRole("button", { name: "Reset Password", exact: true }).click();
      await resetPage.waitForURL(/login\?reset=success/);
      await recipient.goto("http://localhost:3000/account");
      await recipient.waitForURL(/login/);
      await resetPage.goto(resetUrl);
      await expect(resetPage.getByRole("button", { name: "Reset Password", exact: true })).toHaveCount(0);
      await recipientContext.close(); await resetContext.close();
      await page.reload();
      await expect(page.getByLabel("Private recovery link", { exact: true })).toHaveCount(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: betaUser.userId } })).sessionVersion).toBe(1);
    } finally {
      await prisma.passwordRecoveryEvent.deleteMany({ where: { actorUserId: actor.userId } });
    }
  });
}

test("alliance owners cannot access platform password recovery", async ({ page, login, ownerScenario }) => {
  await login({ email: ownerScenario.email, password: ownerScenario.password, displayName: "Owner" });
  await page.goto(`/platform/support/password-recovery?userId=${ownerScenario.userId}`);
  await expect(page).not.toHaveURL(/platform\/support/);
  await expect(page.getByRole("button", { name: "Create recovery link", exact: true })).toHaveCount(0);
});
