import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y } from "../shared/accessibility";

test.skip(process.env.OCR_EVAL_TEST_FIXTURE !== "1", "Requires the isolated OCR fixture job");

for (const width of [320, 820, 1280]) {
  test(`account consent, Settings, cancellation and revocation at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { userId, allianceId, email, password } = ownerScenario;
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "LEADER" } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Leader" });
    const capture = `/alliances/${allianceId}/screenshots?scope=batch`;
    await page.goto(capture);
    await expect(page.getByRole("heading", { name: "Before your first screenshot" })).toBeVisible();
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/human quality review/i)).toHaveCount(0);
    await checkA11y(page);
    await page.screenshot({ path: testInfo.outputPath(`ocr-first-use-${width}.png`), fullPage: true });
    const denied = await page.request.post(`/api/ocr-evaluation?allianceId=${allianceId}&scope=batch`, {
      headers: { origin: new URL(page.url()).origin }, multipart: { consent: "true", screenshot: { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") } },
    });
    expect(denied.status()).toBe(400);
    expect((await denied.json()).error).toContain("Screenshots are disabled");
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Screenshots are disabled", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Allow OCR processing", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Open OCR Settings" }).click();
    await expect(page.getByText("Off", { exact: true })).toBeVisible();
    expect(await prisma.ocrConsentDecision.count({ where: { userId, purpose: "QUALITY_REVIEW" } })).toBe(0);
    await page.getByRole("button", { name: "Enable OCR processing", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Allow OCR processing?", exact: true });
    await checkA11y(page);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await prisma.ocrConsentDecision.findFirstOrThrow({ where: { userId, purpose: "PROCESSING" }, orderBy: { id: "desc" } })).granted).toBe(false);
    await page.getByRole("button", { name: "Enable OCR processing", exact: true }).click();
    await dialog.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByText("Screenshots enabled", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Enable human quality review", exact: true }).click();
    await page.getByRole("dialog", { name: "Allow optional human quality review?" }).getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByText("Optional review enabled", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Turn off human quality review", exact: true }).click();
    await page.getByRole("dialog", { name: "Stop human quality review?" }).getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(page.getByText("Off", { exact: true })).toBeVisible();
    await expect(page.getByText("Screenshots enabled", { exact: true })).toBeVisible();
    await page.goto(capture);
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /I can share/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toBeVisible();
    await page.goto("/account/ocr");
    await page.getByRole("button", { name: "Turn off OCR processing", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Turn off screenshot processing?", exact: true });
    await expect(dialog).toContainText("saved score history remain available");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Screenshots enabled", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Turn off OCR processing", exact: true }).click();
    await dialog.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(page.getByText("Screenshots disabled", { exact: true })).toBeVisible();
    await checkA11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`ocr-settings-${width}.png`), fullPage: true });
    await page.goto(capture);
    await expect(page.getByRole("heading", { name: "Screenshots are disabled", exact: true })).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
  });
}

test("first-use acceptance persists across alliances without granting a role", async ({ page, login, ownerScenario }) => {
  const { userId, allianceId, email, password } = ownerScenario;
  await login({ email, password, displayName: "Owner" });
  await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
  await page.getByRole("button", { name: "Allow OCR processing", exact: true }).click();
  await expect(page.getByLabel("Ranking screenshots", { exact: true })).toBeVisible();
  const another = await prisma.alliance.create({ data: { name: "Another synthetic alliance", server: crypto.randomUUID(), memberships: { create: { userId, role: "LEADER" } } } });
  try {
    await page.goto(`/alliances/${another.id}/screenshots?scope=batch`);
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toBeVisible();
    expect(await prisma.ocrConsentDecision.count({ where: { userId, purpose: "PROCESSING" } })).toBe(1);
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId: another.id, userId } }, data: { role: "VIEWER" } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Screenshot evaluation is unavailable" })).toBeVisible();
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toHaveCount(0);
  } finally { await prisma.allianceMembership.deleteMany({ where: { allianceId: another.id } }); await prisma.alliance.delete({ where: { id: another.id } }); }
});
