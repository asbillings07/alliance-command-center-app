import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import * as XLSX from "xlsx";

test.describe("Multi-period import with atomic period creation", () => {
  test("creates a new period and imports into an existing period in one confirmed batch", async ({
    page,
    login,
    adminScenario,
  }) => {
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

    const proposalPeriodSelects = page.locator('select[id^="multi-period-target-"]');
    await proposalPeriodSelects.first().selectOption({ label: "Create new evaluation period" });
    await expect(page.locator('input[id^="multi-period-target-"][id$="-name"]').first()).toBeVisible();

    const columnPeriodSelects = page.locator('select[id^="multi-period-column-period-"]');
    await columnPeriodSelects.nth(1).selectOption({ value: existingPeriod.id });

    const metricSelects = page.locator('select[aria-label^="Metric for"]');
    await metricSelects.nth(0).selectOption({ label: "Create" });
    await metricSelects.nth(1).selectOption({ label: "Existing Kills" });

    await page.getByRole("button", { name: "Preview Multi-Period Import" }).click();
    await expect(page.getByText("Planned Multi-Period Import")).toBeVisible();
    await expect(page.getByText(existingPeriod.name)).toBeVisible();

    await page.getByRole("button", { name: /Confirm Multi-Period Import/i }).click();
    await expect(page.getByText("Multi-Period Import Complete")).toBeVisible();
    await expect(page.getByText(existingPeriod.name)).toBeVisible();

    const createdPeriod = await prisma.metricPeriod.findFirst({
      where: {
        allianceId,
        name: { contains: "March" },
      },
      include: {
        periodMetrics: true,
      },
    });
    expect(createdPeriod).not.toBeNull();

    const createdEntries = await prisma.memberMetricEntry.count({
      where: { periodId: createdPeriod!.id, allianceMemberId: member.id },
    });
    const existingEntries = await prisma.memberMetricEntry.count({
      where: { periodId: existingPeriod.id, allianceMemberId: member.id },
    });
    expect(createdEntries).toBe(1);
    expect(existingEntries).toBe(1);

    await page.goto(`/alliances/${allianceId}/periods`);
    const periodHeadings = page.locator("h2");
    const periodNames = await periodHeadings.allTextContents();
    const aprilIndex = periodNames.findIndex((name) => name.includes("April 2026 Current"));
    const marchIndex = periodNames.findIndex((name) => name.includes("March"));
    expect(aprilIndex).toBeGreaterThanOrEqual(0);
    expect(marchIndex).toBeGreaterThanOrEqual(0);
    expect(aprilIndex).toBeLessThan(marchIndex);

    await prisma.memberMetricEntry.deleteMany({
      where: { allianceMemberId: member.id },
    });
    await prisma.metricPeriodMetric.deleteMany({
      where: { periodId: { in: [existingPeriod.id, createdPeriod!.id] } },
    });
    await prisma.metricPeriod.deleteMany({
      where: { id: { in: [existingPeriod.id, createdPeriod!.id] } },
    });
    await prisma.metric.deleteMany({
      where: { allianceId, name: { in: ["Existing Kills", "Kills"] } },
    });
    await prisma.allianceMember.delete({ where: { id: member.id } });
  });
});
