import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y, checkA11yWithOptions } from "../shared/accessibility";

async function seedHistory(allianceId: string) {
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale" } });
  const period = await prisma.metricPeriod.create({ data: { allianceId, name: "November week" } });
  const metric = await prisma.metric.create({ data: { allianceId, name: "VS score", type: "NUMERIC", unitLabel: "points" } });
  await prisma.metricPeriodMetric.create({ data: { periodId: period.id, metricId: metric.id, weight: 1, required: false } });
  const old = await prisma.memberMetricEntry.create({ data: {
    allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 23340000,
    recordedAt: new Date("2026-11-10T12:00:00Z"),
  } });
  return { member, period, metric, old, href: `/alliances/${allianceId}/members/${member.id}/history` };
}

for (const width of [320, 820, 1280]) {
  test(`leader records a correction and inspects preserved history at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, email, password, userId } = ownerScenario;
    await prisma.user.update({ where: { id: userId }, data: { displayName: "Maya Chen" } });
    const s = await seedHistory(allianceId);
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Maya Chen" });
    await page.goto(`/alliances/${allianceId}/periods/${s.period.id}/record`);
    await page.getByLabel("Jordan Vale", { exact: true }).fill("26000000");
    await page.getByRole("button", { name: "Save All", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Apply this data?" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByText("November week · 1 entry")).toBeVisible();
    await expect(confirmation.getByText("VS score", { exact: true })).toBeVisible();
    expect(await prisma.memberMetricEntry.count({ where: { allianceMemberId: s.member.id } })).toBe(1);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.getByLabel("Jordan Vale", { exact: true })).toHaveValue("26000000");
    await page.getByLabel("Jordan Vale", { exact: true }).fill("27400000");
    await page.getByRole("button", { name: "Save All", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(page.getByRole("button", { name: "Save All", exact: true })).toBeFocused();
    expect(await prisma.memberMetricEntry.count({ where: { allianceMemberId: s.member.id } })).toBe(1);
    await page.getByRole("button", { name: "Save All", exact: true }).click();
    if (width === 320) {
      await page.setViewportSize({ width, height: 480 });
      const shortBounds = await confirmation.boundingBox();
      expect(shortBounds!.y).toBeGreaterThanOrEqual(0);
      expect(shortBounds!.y + shortBounds!.height).toBeLessThanOrEqual(480);
      await confirmation.getByRole("button", { name: "Yes, apply data" }).scrollIntoViewIfNeeded();
      await expect(confirmation.getByRole("button", { name: "Yes, apply data" })).toBeInViewport();
      await page.setViewportSize({ width, height: 900 });
    }
    await checkA11yWithOptions(page, { include: ["dialog[open]"] });
    const bounds = await confirmation.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`apply-warning-${width}.png`) });
    await confirmation.getByRole("button", { name: "Yes, apply data", exact: true }).click();
    await expect(page.getByText("Recorded 1 entry successfully")).toBeVisible();
    const saved = await prisma.memberMetricEntry.findFirstOrThrow({ where: { allianceMemberId: s.member.id, value: 27400000 } });
    expect(saved).toMatchObject({ enteredByUserId: userId, enteredByName: "Maya Chen", enteredByRole: "OWNER", entryMethod: "MANUAL" });

    await page.goto(`/alliances/${allianceId}/members/${s.member.id}`);
    await page.getByRole("link", { name: "Go back in time", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Go back in time", exact: true })).toBeVisible();
    const list = page.getByRole("region", { name: "Recorded history" });
    const detail = page.getByRole("region", { name: "Entry details" });
    await expect(list.getByRole("link")).toHaveCount(2);
    await expect(list.getByText("23,340,000", { exact: false })).toBeVisible();
    await list.getByRole("link").filter({ hasText: "27,400,000" }).click();
    await expect(detail.getByText("Maya Chen", { exact: true })).toBeVisible();
    await expect(detail.getByText("Manual entry", { exact: true })).toBeVisible();
    await page.reload();
    await expect(detail.getByText("27,400,000", { exact: true })).toBeVisible();
    await expect(page.getByText("Private beta", { exact: true })).toBeVisible();
    if (width < 768) {
      await expect(list).toBeHidden();
      await page.getByRole("link", { name: "← All history" }).click();
      await expect(list).toBeVisible();
      await expect(detail).toBeHidden();
    } else {
      await expect(list).toBeVisible();
      const left = await list.boundingBox();
      const right = await detail.boundingBox();
      expect(right!.x).toBeGreaterThan(left!.x + left!.width);
    }
    await list.getByRole("link").filter({ hasText: "23,340,000" }).click();
    await expect(detail.getByText("Uploader not recorded", { exact: true })).toBeVisible();
    await expect(detail.getByText("23,340,000", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`history-${width}.png`), fullPage: true });
    expect(await prisma.memberMetricEntry.count({ where: { allianceMemberId: s.member.id } })).toBe(2);
    expect((await prisma.memberMetricEntry.findUniqueOrThrow({ where: { id: saved.id } })).value).toBe(27400000);
  });
}

test("history remains keyboard accessible on phone and tablet @a11y", async ({ page, login, ownerScenario }) => {
  const { allianceId, email, password } = ownerScenario;
  const s = await seedHistory(allianceId);
  await login({ email, password, displayName: "Owner" });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(s.href);
    await checkA11y(page);
    const link = page.getByRole("region", { name: "Recorded history" }).getByRole("link").first();
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Entry details" })).toBeVisible();
    await checkA11y(page);
  }
});

test("each spreadsheet batch needs a fresh apply confirmation", async ({ page, login, ownerScenario }, testInfo) => {
  test.setTimeout(120000);
  const { allianceId, email, password } = ownerScenario;
  const s = await seedHistory(allianceId);
  await page.setViewportSize({ width: 820, height: 900 });
  await login({ email, password, displayName: "Owner" });
  await page.goto(`/alliances/${allianceId}/periods/${s.period.id}/import`);
  for (const [index, value] of [27400000, 28000000].entries()) {
    await page.locator('#csv-upload').setInputFiles({ name: 'scores.csv', mimeType: 'text/csv', buffer: Buffer.from(`Player,VS score\nJordan Vale,${value}`) });
    await page.getByRole("button", { name: /Preview Import/ }).click();
    const dialog = page.getByRole("dialog", { name: "Apply this data?" });
    await expect(dialog).toBeHidden();
    expect(await prisma.memberMetricEntry.count({ where: { allianceMemberId: s.member.id } })).toBe(index + 1);
    await page.getByRole("button", { name: /Import All/ }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("November week · 1 entry")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await prisma.memberMetricEntry.count({ where: { allianceMemberId: s.member.id } })).toBe(index + 1);
    await page.getByRole("button", { name: /Import All/ }).click();
    await checkA11yWithOptions(page, { include: ["dialog[open]"] });
    if (index === 0) await page.screenshot({ path: testInfo.outputPath("import-apply-warning-820.png") });
    await dialog.getByRole("button", { name: "Yes, apply data" }).click();
    await expect(page.getByText("Evaluation Results Imported", { exact: true })).toBeVisible();
    const saved = await prisma.memberMetricEntry.findFirstOrThrow({ where: { allianceMemberId: s.member.id, value } });
    expect(saved.entryMethod).toBe("SPREADSHEET_SINGLE_PERIOD");
    if (index === 0) await page.getByRole("button", { name: "Import More Results" }).click();
  }
});
