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

test("manual timing resumes after reload and counts only confirmed saves in elapsed times", async ({ page, login, ownerScenario }) => {
  const { allianceId, userId } = ownerScenario;
  const period = await prisma.metricPeriod.create({ data: { allianceId, name: "Timing fixture" } });
  const metric = await prisma.metric.create({ data: { allianceId, name: "Timing points", type: "NUMERIC" } });
  await prisma.metricPeriodMetric.create({ data: { periodId: period.id, metricId: metric.id, weight: 1, required: false } });
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Timing fixture player" } });
  const path = `/alliances/${allianceId}/periods/${period.id}/record`;
  await login({ ...ownerScenario, displayName: "Operator" });
  await page.goto(path);
  const start = page.getByRole("button", { name: "Start timed entry" });
  const stop = page.getByRole("button", { name: "Stop timing" });
  await start.click();
  await expect(stop).toBeVisible();
  await page.reload();
  await stop.click();
  await start.click();
  await expect(stop).toBeVisible();
  await page.getByLabel(member.playerName).fill("15");
  await page.getByRole("button", { name: "Save All" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(stop).toBeVisible();
  await page.getByRole("button", { name: "Save All" }).click();
  await page.getByRole("button", { name: "Yes, apply data" }).click();
  await expect(page.getByText(/Recorded 1 entry successfully/)).toBeVisible();
  const tasks = await prisma.qaManualTiming.findMany({ where: { userId, periodId: period.id }, select: { endedAt: true, savedRows: true } });
  expect(tasks).toHaveLength(2);
  expect(tasks.filter(row => row.endedAt && row.savedRows === 1)).toHaveLength(1);
  expect(tasks.filter(row => row.endedAt && row.savedRows === null)).toHaveLength(1);
  expect(await prisma.memberMetricEntry.count({ where: { periodId: period.id } })).toBe(1);
  await prisma.user.update({ where: { id: userId }, data: { isPlatformAdmin: true } });
  try {
    await page.goto("/platform/ocr-readiness");
    await expect(page.getByText("1 row per task")).toBeVisible();
    await expect(page.getByText(/1 saved · Median/)).toBeVisible();
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { isPlatformAdmin: false } });
    await prisma.qaManualTiming.deleteMany({ where: { userId } });
  }
});
