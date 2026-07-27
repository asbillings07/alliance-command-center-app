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

  test("@a11y keeps import preview navigator accessible with one active metric workspace", async ({
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

    const navigator = page.getByTestId("metric-preview-navigator");
    await expect(navigator).toBeVisible();
    await expect(navigator).toContainText("Metric 1 of 2");
    await expect(navigator).toContainText("1 need review");

    const activePreview = page.locator('[data-metric-status="needs_review"]');
    await expect(activePreview).toHaveCount(1);
    await expect(activePreview).toHaveAttribute("data-testid", "metric-preview-1");
    await expect(page.getByTestId("metric-preview-2")).toHaveCount(0);

    await page.getByTestId("metric-preview-next").click();
    await expect(navigator).toContainText("Metric 2 of 2");
    await expect(page.locator('[data-metric-status="ready"]')).toHaveCount(1);
    await expect(page.getByTestId("metric-preview-2")).toHaveCount(1);
    await expect(page.getByTestId("metric-preview-1")).toHaveCount(0);

    await page.getByTestId("metric-preview-jump").selectOption("0");
    await expect(page.getByTestId("metric-preview-1")).toHaveCount(1);
    await expect(page.getByTestId("metric-preview-2")).toHaveCount(0);

    await page.getByTestId("metric-preview-needs-review-filter").click();
    await expect(navigator).toContainText("Needs review 1 of 1");
    await expect(page.getByTestId("metric-preview-next")).toBeDisabled();

    await page.getByTestId("metric-preview-previous").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("metric-preview-previous")).toBeDisabled();

    await expect(translations.locator("summary")).toHaveAttribute("aria-expanded", "false");

    await checkA11yWithOptions(page, {
      runOnly: ["wcag2a", "wcag2aa"],
      include: [
        '[data-testid="source-column-translations"]',
        '[role="region"][aria-label="Metric import previews"]',
        '[data-testid="metric-preview-needs-attention"]',
        '[data-testid="metric-preview-will-import"]',
      ],
    });
  });

  test("leaders can navigate metric previews one at a time during import review", async ({
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

    const activePreview = page.getByTestId("metric-preview-1");
    await expect(activePreview).toHaveAttribute("data-metric-status", "ready");
    await expect(activePreview.getByText("1 importable")).toBeVisible();
    await expect(page.getByTestId("metric-preview-row-detail")).toHaveCount(1);
    await expect(page.getByTestId("metric-preview-needs-attention")).toHaveCount(0);

    const willImport = page.getByTestId("metric-preview-will-import");
    await expect(willImport).toContainText("1 row will import");
    await willImport.locator("summary").click();
    await expect(activePreview.getByRole("cell", { name: "DisclosureHero" }).first()).toBeVisible();
  });

  test("groups active metric rows by outcome with needs-attention open and will-import collapsed", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    const killPoints = await prisma.metric.create({
      data: { allianceId, name: "Kill Points", type: "NUMERIC" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: "Grouping Period",
        active: true,
        periodMetrics: {
          create: { metricId: killPoints.id, weight: 1, required: false },
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
      "Player,Kill Points",
      "DisclosureHero,1000",
      "DisclosurePhoenix,2000",
      "GhostPlayer,999",
    ].join("\n");

    await page.locator('input[type="file"]').setInputFiles({
      name: "grouping.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });

    await page.getByRole("button", { name: "Preview Import" }).click();

    const needsAttention = page.getByTestId("metric-preview-needs-attention");
    const willImport = page.getByTestId("metric-preview-will-import");

    await expect(needsAttention).toBeVisible();
    await expect(needsAttention).toContainText("1 need attention");
    await expect(needsAttention.locator("summary")).toHaveAttribute("aria-expanded", "true");
    await expect(needsAttention.getByText("GhostPlayer")).toBeVisible();

    await expect(willImport).toBeVisible();
    await expect(willImport).toContainText("2 rows will import");
    await expect(willImport.locator("summary")).toHaveAttribute("aria-expanded", "false");
    await expect(willImport.locator("tbody")).toBeHidden();

    await willImport.locator("summary").click();
    await expect(willImport.locator("summary")).toHaveAttribute("aria-expanded", "true");
    await expect(willImport.locator("tbody")).toBeVisible();
    await expect(willImport.getByRole("cell", { name: "DisclosureHero" }).first()).toBeVisible();
    await expect(willImport.getByRole("cell", { name: "DisclosurePhoenix" }).first()).toBeVisible();

    await needsAttention.locator("summary").focus();
    await page.keyboard.press(" ");
    await expect(needsAttention.locator("summary")).toHaveAttribute("aria-expanded", "false");
    await expect(needsAttention).toContainText("1 need attention");

    await willImport.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(willImport.locator("summary")).toHaveAttribute("aria-expanded", "true");
  });
});
