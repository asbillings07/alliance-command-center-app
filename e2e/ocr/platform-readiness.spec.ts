import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y } from "../shared/accessibility";

test.skip(process.env.OCR_EVAL_TEST_FIXTURE !== "1", "Requires isolated evaluation fixtures");

test("only a Platform admin sees release evidence and QA scan totals", async ({ page, login, ownerScenario }) => {
  const path = "/platform/ocr-readiness";
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "OCR release readiness" })).toHaveCount(0);
  await login({ ...ownerScenario, displayName: "Owner" });
  await page.goto(path);
  await expect(page).not.toHaveURL(new RegExp(path));
  await expect(page.getByText("QA scan activity")).toHaveCount(0);
  await prisma.user.update({ where: { id: ownerScenario.userId }, data: { isPlatformAdmin: true } });
  try {
    await page.goto("/platform/overview");
    await page.getByRole("link", { name: /Review OCR release readiness/ }).click();
    for (const width of [320, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("heading", { name: "OCR release readiness" })).toBeVisible();
      await expect(page.getByText("Not enough evidence", { exact: true })).toHaveCount(2);
      await expect(page.getByText(/All \d+ reserved scan attempts/)).toBeVisible();
      const detail = page.locator("details").filter({ hasText: "Silent critical errors" });
      await detail.locator("summary").click();
      await expect(detail.getByText(/Audited counts/)).toBeVisible();
      await checkA11y(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await detail.locator("summary").click();
    }
  } finally {
    await prisma.user.update({ where: { id: ownerScenario.userId }, data: { isPlatformAdmin: false } });
  }
});
