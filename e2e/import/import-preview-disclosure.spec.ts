import { test, expect } from "../shared/fixtures";
import { checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";

test.describe("Results import preview progressive disclosure", () => {
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
          playerName: { in: ["DisclosureHero", "DisclosureGhost", "DisclosurePhoenix"] },
        },
      });
    }
  });

  test("@a11y keeps import preview disclosures accessible with collapsed defaults", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    const killPoints = await prisma.metric.create({
      data: { allianceId, name: "Kill Points", type: "NUMERIC" },
    });
    const heroPower = await prisma.metric.create({
      data: { allianceId, name: "Hero Power", type: "NUMERIC" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: "Disclosure Period",
        active: true,
        periodMetrics: {
          create: [
            { metricId: killPoints.id, weight: 1, required: false },
            { metricId: heroPower.id, weight: 1, required: false },
          ],
        },
      },
    });

    await prisma.allianceMember.createMany({
      data: [
        { allianceId, playerName: "DisclosureHero" },
        { allianceId, playerName: "DisclosurePhoenix" },
      ],
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/periods/${period.id}/import`);

    const csvContent = [
      "Player,Kill Points,Hero Power",
      "DisclosureHero,1000,200",
      "DisclosurePhoenix,2000,400",
      "GhostPlayer,999,",
    ].join("\n");

    await page.locator('input[type="file"]').setInputFiles({
      name: "disclosure.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    await page.getByRole("button", { name: "Preview Import" }).click();
    await expect(page.getByText("Planned Metric Translation")).toBeVisible();

    const translations = page.getByTestId("source-column-translations");
    await expect(translations).toBeVisible();
    await expect(translations.getByText("All columns mapped")).toBeVisible();

    const killPointsPreview = page.getByTestId("metric-preview-1");
    const heroPowerPreview = page.getByTestId("metric-preview-2");
    await expect(killPointsPreview).toHaveAttribute("data-metric-status", "needs_review");
    await expect(heroPowerPreview).toHaveAttribute("data-metric-status", "ready");

    await expect(killPointsPreview).toHaveAttribute("open", "");
    await expect(heroPowerPreview).not.toHaveAttribute("open");

    await heroPowerPreview.locator("#metric-preview-summary-2").click();
    await expect(heroPowerPreview).toHaveAttribute("open", "");
    await expect(killPointsPreview).toHaveAttribute("open", "");

    await killPointsPreview.locator("#metric-preview-summary-1").focus();
    await page.keyboard.press("Enter");
    await expect(killPointsPreview).not.toHaveAttribute("open");
    await expect(killPointsPreview.locator("#metric-preview-summary-1")).toHaveAttribute("aria-expanded", "false");

    await heroPowerPreview.locator("#metric-preview-summary-2").focus();
    await page.keyboard.press("Space");
    await expect(heroPowerPreview).not.toHaveAttribute("open");
    await expect(heroPowerPreview.locator("#metric-preview-summary-2")).toHaveAttribute("aria-expanded", "false");

    await expect(translations.locator("summary")).toHaveAttribute("aria-expanded", "false");

    await checkA11yWithOptions(page, {
      runOnly: ["wcag2a", "wcag2aa"],
      include: [
        '[data-testid="source-column-translations"]',
        '[role="region"][aria-label="Metric import previews"]',
      ],
    });
  });

  test("leaders can expand any metric preview independently during import review", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    const metric = await prisma.metric.create({
      data: { allianceId, name: "Kill Points", type: "NUMERIC" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: "Navigation Period",
        active: true,
        periodMetrics: {
          create: { metricId: metric.id, weight: 1, required: false },
        },
      },
    });

    await prisma.allianceMember.create({
      data: { allianceId, playerName: "DisclosureHero" },
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/periods/${period.id}/import`);

    const csvContent = "Player,Kill Points\nDisclosureHero,1500";
    await page.locator('input[type="file"]').setInputFiles({
      name: "clean.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    await page.getByRole("button", { name: "Preview Import" }).click();

    const metricPreview = page.getByTestId("metric-preview-1");
    await expect(metricPreview).toHaveAttribute("data-metric-status", "ready");
    await expect(metricPreview).not.toHaveAttribute("open");
    await expect(metricPreview.getByText("1 importable")).toBeVisible();

    await metricPreview.locator("#metric-preview-summary-1").click();
    await expect(metricPreview).toHaveAttribute("open", "");
    await expect(metricPreview.getByRole("cell", { name: "DisclosureHero" }).first()).toBeVisible();
  });
});
