import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";

test.describe("Creation continuity (#200 PR 2)", () => {
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
      where: { allianceId, name: { startsWith: "Continuity Period" } },
    });
    await prisma.metric.deleteMany({
      where: { allianceId, name: { startsWith: "Continuity Metric" } },
    });
  });

  test("create period → configure metrics → attach → return to period detail", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/periods`);

    await page.getByRole("button", { name: "+ Create Period" }).click();
    const periodName = `Continuity Period ${Date.now()}`;
    await page.getByLabel(/^name$/i).fill(periodName);
    await page.getByRole("button", { name: "Create Period" }).click();

    await expect(page.getByText("Evaluation period created.")).toBeVisible();
    await page.getByRole("link", { name: "Configure metrics for this period" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/alliances/${allianceId}/metrics\\?returnTo=`),
    );

    await page.getByRole("button", { name: "+ Create Metric" }).click();
    const metricName = `Continuity Metric ${Date.now()}`;
    await page.getByLabel(/^name$/i).fill(metricName);
    await page.getByRole("button", { name: "Create Metric" }).click();

    await expect(page.getByText("Continue configuring this period")).toBeVisible();
    await page.getByRole("link", { name: "Continue configuring this period" }).click();
    await expect(page).toHaveURL(new RegExp(`/alliances/${allianceId}/periods/`));

    await expect(
      page.getByText("No metrics have been configured for this period yet"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add Metric" }).click();
    await page.selectOption('select[name="metricId"]', { label: metricName });
    await page.fill('input[name="weight"]', "10");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.locator("dialog")).not.toBeVisible();

    const configuredMetricRow = page.locator("li").filter({ hasText: metricName });
    await expect(configuredMetricRow).toBeVisible();
    await expect(configuredMetricRow.getByText("Weight: 10")).toBeVisible();
    await expect(
      page.getByText("No metrics have been configured for this period yet"),
    ).not.toBeVisible();

    const periodId = page.url().match(/\/periods\/([^/]+)$/)?.[1];
    expect(periodId).toBeTruthy();
    const attachment = await prisma.metricPeriodMetric.findFirst({
      where: {
        periodId,
        metric: { allianceId, name: metricName },
      },
    });
    expect(attachment).not.toBeNull();
  });

  test("create metric from library guides attach when no returnTo", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/metrics`);

    await page.getByRole("button", { name: "+ Create Metric" }).click();
    const metricName = `Continuity Metric ${Date.now()}`;
    await page.getByLabel(/^name$/i).fill(metricName);
    await page.getByRole("button", { name: "Create Metric" }).click();

    await expect(
      page.getByText(
        "Attach it to an evaluation period to start recording results.",
      ),
    ).toBeVisible();

    const attachLink = page.getByRole("link", {
      name: /Attach to evaluation period|Go to Evaluation Periods/,
    });
    await expect(attachLink).toBeVisible();
  });
});
