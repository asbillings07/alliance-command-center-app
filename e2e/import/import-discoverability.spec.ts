import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";

test.describe("Import Discoverability & Navigation Bridge", () => {
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

    // Step 2: Go to Member Import page
    await page.goto(`/alliances/${allianceId}/members/import`);
    await expect(page.getByRole("heading", { name: /Import Members/i })).toBeVisible();

    // Step 3: Upload CSV with a new player
    const csvContent = `Player,THP,Role\nDiscoverableHero,450000000,R4`;
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    // Step 4: Complete import
    await expect(page.getByText("Preview Members")).toBeVisible();
    await page.getByRole("button", { name: "Import Members" }).click();

    await expect(page.getByRole("heading", { name: "Members Imported" })).toBeVisible();

    // Step 5: Click View Members action link
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

    // Create period and active member
    const period = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: "Discoverability Period",
        active: true,
      },
    });

    await prisma.allianceMember.create({
      data: {
        allianceId,
        playerName: "ScoreTestPlayer",
      },
    });

    await login({ email, password, displayName: "Admin User" });

    // Step 1: Navigate to Metric Results Import page
    await page.goto(`/alliances/${allianceId}/periods/${period.id}/import`);
    await expect(page.getByText(`Destination Period: ${period.name}`)).toBeVisible();

    // Step 2: Upload CSV with metric data
    const csvContent = `Player,Kill Points\nScoreTestPlayer,1250000`;
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "results.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    await expect(page.getByText("Preview Import")).toBeVisible();
    await page.getByRole("button", { name: "Preview Import" }).click();

    await expect(page.getByRole("button", { name: "Import All" })).toBeVisible();
    await page.getByRole("button", { name: "Import All" }).click();

    await expect(page.getByRole("heading", { name: "Evaluation Results Imported" })).toBeVisible();

    // Step 3: Click View Evaluation Period
    await page.getByRole("link", { name: "View Evaluation Period" }).click();

    // Step 4: Verify Recorded Results Coverage card
    await expect(page.getByText("Recorded Results Coverage")).toBeVisible();
    await expect(page.getByText("1 participating member")).toBeVisible();

    // Step 5: Click View Member Results
    await page.getByRole("link", { name: "View Member Results" }).click();

    // Step 6: Verify URL has ?periodId=
    expect(page.url()).toContain(`periodId=${period.id}`);

    // Step 7: Click player link to view profile
    await page.getByRole("link", { name: "ScoreTestPlayer" }).click();

    // Step 8: Verify profile URL maintains period context or displays imported metric
    await expect(page.getByText("1.3M")).toBeVisible();
  });
});
