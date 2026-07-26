import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import * as XLSX from "xlsx";

test.describe("Multi-period import with atomic period creation", () => {
  test.afterEach(async ({ adminScenario }) => {
    if (!adminScenario?.allianceId) return;

    await prisma.memberMetricEntry.deleteMany({
      where: { allianceMember: { allianceId: adminScenario.allianceId } },
    });
    await prisma.metricPeriodMetric.deleteMany({
      where: { period: { allianceId: adminScenario.allianceId } },
    });
    await prisma.metricPeriod.deleteMany({
      where: { allianceId: adminScenario.allianceId },
    });
    await prisma.metric.deleteMany({
      where: { allianceId: adminScenario.allianceId },
    });
    await prisma.allianceMember.deleteMany({
      where: {
        allianceId: adminScenario.allianceId,
        playerName: "MultiPeriodHero",
      },
    });
  });

  test("creates a new period and imports into an existing period in one confirmed batch", async ({
    page,
    login,
    adminScenario,
  }) => {
    test.setTimeout(90_000);

    const { allianceId, email, password } = adminScenario;

    const member = await prisma.allianceMember.create({
      data: {
        allianceId,
        playerName: "MultiPeriodHero",
      },
    });

    const existingMetric = await prisma.metric.create({
      data: {
        allianceId,
        name: "Existing Kills",
        type: "NUMERIC",
      },
    });

    const existingPeriod = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: "April 2026 Current",
        active: true,
        startsAt: new Date("2026-04-06T00:00:00.000Z"),
        endsAt: new Date("2026-04-13T00:00:00.000Z"),
        periodMetrics: {
          create: {
            metricId: existingMetric.id,
            weight: 1,
            required: false,
          },
        },
      },
    });

    await login({ email, password, displayName: "Admin User" });

    await page.goto(`/alliances/${allianceId}/periods/${existingPeriod.id}/import`);
    await expect(page.getByText(`Destination Period: ${existingPeriod.name}`)).toBeVisible();

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Player", "Kills on 3/29", "Kills on 4/13"],
      ["MultiPeriodHero", "1500", "2500"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "March 2026");
    const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    await page.locator('input[type="file"]').setInputFiles({
      name: "multi_period_atomic.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxBuffer,
    });

    await page.getByRole("button", { name: "Review & Map to Existing Periods" }).click();
    await expect(page.getByText("Map proposals to evaluation periods")).toBeVisible();

    await page.locator('select[id^="multi-period-target-"]').first().selectOption({
      value: "__create_period__",
    });

    await page.locator('select[id^="multi-period-column-period-"]').nth(1).selectOption({
      value: existingPeriod.id,
    });

    const metricSelects = page.locator('select[aria-label^="Metric for"]');
    await metricSelects.nth(0).selectOption({ value: "create" });
    await metricSelects.nth(1).selectOption({ value: `existing:${existingMetric.id}` });

    await page.getByRole("button", { name: "Preview Multi-Period Import" }).click();
    await expect(page.getByText("Planned Multi-Period Import")).toBeVisible();
    await expect(page.getByRole("strong", { name: existingPeriod.name })).toBeVisible();

    await page.getByRole("button", { name: /Confirm Multi-Period Import/i }).click();
    await expect(page.getByText("Multi-Period Import Complete")).toBeVisible();
    await expect(page.getByRole("heading", { name: existingPeriod.name })).toBeVisible();

    const createdPeriod = await prisma.metricPeriod.findFirst({
      where: {
        allianceId,
        NOT: { id: existingPeriod.id },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(createdPeriod).not.toBeNull();

    expect(
      await prisma.memberMetricEntry.count({
        where: { periodId: createdPeriod!.id, allianceMemberId: member.id },
      }),
    ).toBe(1);
    expect(
      await prisma.memberMetricEntry.count({
        where: { periodId: existingPeriod.id, allianceMemberId: member.id },
      }),
    ).toBe(1);

    await page.goto(`/alliances/${allianceId}/periods`);
    await expect(page.getByRole("heading", { name: "Evaluation Periods" })).toBeVisible();

    const periodNames = await page.locator("h2").allTextContents();
    const aprilIndex = periodNames.findIndex((name) => name.includes("April 2026 Current"));
    const createdIndex = periodNames.findIndex((name) => name.includes(createdPeriod!.name));
    expect(aprilIndex).toBeGreaterThanOrEqual(0);
    expect(createdIndex).toBeGreaterThanOrEqual(0);
    expect(aprilIndex).toBeLessThan(createdIndex);
  });
});
