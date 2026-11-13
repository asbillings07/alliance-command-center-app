import crypto from "node:crypto";
import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11yLevelAA } from "../shared/accessibility";

for (const width of [390, 820, 1280]) {
  test(`alliance sign-up displays and preserves the invited email at ${width}px`, async ({ page, ownerScenario }, testInfo) => {
    const { allianceId, userId } = ownerScenario;
    const email = `invited-${crypto.randomUUID()}@example.com`;
    const otherEmail = `other-${crypto.randomUUID()}@example.com`;
    const invitation = await prisma.invitation.create({
      data: {
        allianceId,
        invitedById: userId,
        playerNameSnapshot: "Jordan Vale",
        email,
        membershipRole: "VIEWER",
        token: crypto.randomUUID(),
        code: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    try {
      await page.setViewportSize({ width, height: 900 });
      // Both emailed links and code-based entry must carry the stored email.
      for (const invitePath of [
        `/invite/${invitation.token}`,
        `/invite/code?code=${encodeURIComponent(invitation.code!)}`,
      ]) {
        await page.goto(invitePath);
        await page.getByRole("link", { name: "Create Account to Join" }).click();
        await expect(page.getByRole("heading", { name: "Create Account", exact: true })).toBeVisible();
        const displayedEmail = page.getByText(email, { exact: true });
        await expect(displayedEmail).toBeVisible();
        await expect(displayedEmail).not.toHaveAttribute("contenteditable", "true");
        await expect(page.locator('input[name="email"]')).toHaveAttribute("type", "hidden");
        await expect(page.locator('input[name="email"]')).toHaveValue(email);
        await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCount(0);
        // The fixed field uses the readable muted-grey design token, not an
        // editable input or low-opacity disabled text.
        expect(await displayedEmail.evaluate((element) => {
          const sample = document.createElement("span");
          sample.style.color = "var(--text-muted)";
          document.body.append(sample);
          const matches = getComputedStyle(element).color === getComputedStyle(sample).color;
          sample.remove();
          return matches;
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }

      await checkA11yLevelAA(page);
      await page.screenshot({ path: testInfo.outputPath(`invited-email-${width}.png`), fullPage: true });
      await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
      await page.getByLabel("Confirm Password", { exact: true }).fill("DifferentPassword123!");
      await page.getByRole("button", { name: "Create Account", exact: true }).click();
      await expect(page.getByText("Passwords do not match", { exact: true })).toBeVisible();
      await expect(page.getByText(email, { exact: true })).toBeVisible();

      if (width === 1280) {
        // A forged submitted value still cannot register another address.
        await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
        await page.getByLabel("Confirm Password", { exact: true }).fill("TestPassword123!");
        await page.locator('input[name="email"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, otherEmail);
        await page.getByRole("button", { name: "Create Account", exact: true }).click();
        await expect(page.getByText("Email does not match the invitation", { exact: true })).toBeVisible();
        expect(await prisma.user.count({ where: { email: { in: [email, otherEmail] } } })).toBe(0);

        await page.reload();
        await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
        await page.getByLabel("Confirm Password", { exact: true }).fill("TestPassword123!");
        await page.getByRole("button", { name: "Create Account", exact: true }).click();
        await expect(page.getByRole("button", { name: /^Join Owner Test Alliance/ })).toBeVisible();
        const account = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(account.displayName).toBe("Jordan Vale");
        expect(await prisma.allianceMembership.count({ where: { userId: account.id } })).toBe(0);
      }
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    }
  });
}
