import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";

test.describe("Members period results (#200 PR 4)", () => {
  test.afterEach(async ({ adminScenario }) => {
    if (!adminScenario?.allianceId) return;

    const { allianceId } = adminScenario;
    await prisma.memberMetricEntry.deleteMany({
      where: { allianceMember: { allianceId } },
    });
    await prisma.metricPeriodMetric.deleteMany({
      where: { period: { allianceId } },
    });
    await prisma.metricPeriod.deleteMany({
      where: { allianceId, name: { startsWith: "Members E2E" } },
    });
    await prisma.allianceMember.deleteMany({
      where: { allianceId, playerName: "MembersE2EHero" },
    });
  });

  test("defaults to roster-only and can switch period results views", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: `Members E2E Period ${Date.now()}`,
        active: true,
      },
    });

    await page.goto(`/alliances/${allianceId}/members`);
    await expect(page.getByText("Viewing:")).toBeVisible();
    await expect(page.getByText("Roster only")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Kill Points" })).toHaveCount(0);

    await page.getByLabel("Evaluation period").selectOption(period.id);
    await expect(page).toHaveURL(new RegExp(`periodId=${period.id}`));
    await expect(page.getByText("Evaluation results for:")).toBeVisible();

    await page.getByLabel("Evaluation period").selectOption("");
    await expect(page).toHaveURL(`/alliances/${allianceId}/members?filter=active`);
    await expect(page.getByText("Roster only")).toBeVisible();
  });

  test("shows invalid period notice for bad deep links", async ({ page, login, adminScenario }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?periodId=missing-period-id`);

    await expect(page.getByText("This evaluation period is not available")).toBeVisible();
    await page.getByRole("link", { name: "Return to roster" }).click();
    await expect(page).toHaveURL(`/alliances/${allianceId}/members?filter=active`);
  });
});
