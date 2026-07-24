import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";

test.describe("Import Discoverability & Navigation Bridge", () => {
  test.afterEach(async ({ adminScenario }) => {
    if (adminScenario?.allianceId) {
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
          playerName: { in: ["DiscoverableHero", "ScoreTestPlayer"] },
        },
      });
    }
  });

  test("member import immediately refreshes member list even when router cache is warm", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });

    // Step 1: Visit /members to warm router client cache
    await page.goto(`/alliances/${allianceId}/members`);
    await expect(page.getByRole("heading", { name: /Roster/i })).toBeVisible();

    // Step 2: In-app navigate to Member Import page via Client Link
    await page.getByRole("link", { name: "Import Members" }).click();
    await expect(page.getByRole("heading", { name: "Member Import" })).toBeVisible();

    // Step 3: Upload CSV with a new player
    const csvContent = `Player,THP,Role\nDiscoverableHero,450000000,R4`;
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    // Step 4: Complete import
    const importBtn = page.getByRole("button", { name: /Import .* Member/i });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    await expect(page.getByRole("heading", { name: "Members Imported" })).toBeVisible();

    // Step 5: Click View Members action link (Client Link transition)
    await page.getByRole("link", { name: "View Members" }).click();

    // Step 6: Verify new member is immediately discoverable in member list
    await expect(page.getByText("DiscoverableHero")).toBeVisible();
  });

  test("metric results import updates period coverage and displays metrics on member profile", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    // Create metric, period with attached metric, and active member
    const metric = await prisma.metric.create({
      data: {
        allianceId,
        name: "Kill Points",
        type: "NUMERIC",
      },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: "Discoverability Period",
        active: true,
        periodMetrics: {
          create: {
            metricId: metric.id,
            weight: 1,
            required: false,
          },
        },
      },
    });

    await prisma.allianceMember.create({
      data: {
        allianceId,
        playerName: "ScoreTestPlayer",
      },
    });

    await login({ email, password, displayName: "Admin User" });

    // Step 1: Visit Evaluation Period page to warm router client cache
    await page.goto(`/alliances/${allianceId}/periods/${period.id}`);
    await expect(page.getByRole("heading", { name: period.name })).toBeVisible();

    // Step 2: In-app navigate to Import Evaluation Results page via Client Link
    await page.getByRole("link", { name: "Import Evaluation Results" }).click();
    await expect(page.getByText(`Destination Period: ${period.name}`)).toBeVisible();

    // Step 3: Upload CSV with metric data
    const csvContent = `Player,Kill Points\nScoreTestPlayer,1250000`;
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "results.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    await expect(page.getByRole("button", { name: "Preview Import" })).toBeEnabled();
    await page.getByRole("button", { name: "Preview Import" }).click();

    await expect(page.getByRole("button", { name: /Import/i })).toBeVisible();
    await page.getByRole("button", { name: /Import/i }).click();

    await expect(page.getByRole("heading", { name: "Evaluation Results Imported" })).toBeVisible();

    // Step 4: Click View Evaluation Period (Client Link)
    await page.getByRole("link", { name: "View Evaluation Period" }).click();

    // Step 5: Verify Recorded Results Coverage card
    await expect(page.getByText("Recorded Results Coverage")).toBeVisible();
    await expect(page.getByText("1 participating member")).toBeVisible();

    // Step 6: Click View Member Results (Client Link)
    await page.getByRole("link", { name: "View Member Results" }).click();
    await page.waitForURL((url) => url.searchParams.get("periodId") === period.id);

    // Step 7: Verify URL has ?periodId=
    expect(page.url()).toContain(`periodId=${period.id}`);

    // Step 8: Click player link to view profile
    await page.getByRole("link", { name: "ScoreTestPlayer" }).click();

    // Step 9: Verify Member Profile page displays imported metric
    await expect(page.getByText("1.3M")).toBeVisible();
  });
});
