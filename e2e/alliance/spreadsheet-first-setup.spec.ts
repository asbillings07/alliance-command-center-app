import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";

const DATA_BLOCKED_BY_MEMBERS =
  "An Admin or Owner must import members before you can import evaluation results.";

test.describe("Spreadsheet-first setup (#185 PR 3)", () => {
  test.afterEach(async ({ adminScenario, leaderScenario }) => {
    const allianceIds = [adminScenario?.allianceId, leaderScenario?.allianceId].filter(
      Boolean,
    ) as string[];

    for (const allianceId of allianceIds) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId } },
      });
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId } },
      });
      await prisma.metricPeriod.deleteMany({ where: { allianceId } });
      await prisma.metric.deleteMany({ where: { allianceId } });
      await prisma.allianceMember.deleteMany({
        where: {
          allianceId,
          playerName: { in: ["SetupHero", "SpreadsheetHero"] },
        },
      });
    }
  });

  test("spreadsheet-first journey: members gate, import, analyze, confirm, view results", async ({
    page,
    betaUser,
  }) => {
    test.setTimeout(120_000);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(betaUser.email);
    await page.getByLabel(/password/i).fill(betaUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/create-alliance/);

    const allianceName = `Spreadsheet Setup ${Date.now()}`;
    await page.getByLabel(/alliance name/i).fill(allianceName);
    await page.getByRole("button", { name: /create/i }).click();
    await page.waitForURL(/\/alliances\/.*\/setup/);

    const allianceId = page.url().match(/\/alliances\/([^/]+)\/setup/)?.[1];
    expect(allianceId).toBeTruthy();

    await expect(
      page.getByRole("link", { name: "Start with a spreadsheet" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Start with a spreadsheet" }).click();
    await expect(page).toHaveURL(`/alliances/${allianceId}/setup/import`);
    await expect(page.getByText("Import members first")).toBeVisible();

    await page.getByRole("link", { name: "Import Members" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/alliances/${allianceId}/members/import\\?returnTo=`),
    );

    const rosterCsv = "Player,THP,Role\nSpreadsheetHero,450000000,R4";
    await page.locator('input[type="file"]').setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(rosterCsv),
    });
    await page.getByRole("button", { name: /Import .* Member/i }).click();
    await expect(page.getByText("Committed Alliance Member Translation")).toBeVisible();

    await page.getByRole("link", { name: "Continue Setup" }).click();
    await expect(page).toHaveURL(`/alliances/${allianceId}/setup/import`);
    await expect(page.getByText("Import members first")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Select Evaluation Results File" }),
    ).toBeVisible();

    const resultsCsv = "Player,Kill Points\nSpreadsheetHero,1250000";
    await page.locator("#setup-import-upload").setInputFiles({
      name: "results.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(resultsCsv),
    });

    await expect(page.getByText("Workbook analysis")).toBeVisible();
    await page.getByRole("button", { name: "Continue to Column Mapping" }).click();

    const periodSelect = page.locator('select[id^="multi-period-target-"]').first();
    await periodSelect.selectOption({ value: "__create_period__" });

    const periodName = `Setup Period ${Date.now()}`;
    await page.locator('input[id^="multi-period-target-"][id$="-name"]').fill(periodName);

    const metricSelect = page.locator('select[aria-label^="Metric for"]').first();
    await metricSelect.selectOption({ value: "create" });

    await page.getByRole("button", { name: "Preview Multi-Period Import" }).click();
    await expect(page.getByText("Planned Multi-Period Import")).toBeVisible();

    await page.getByRole("button", { name: /Confirm Multi-Period Import/i }).click();
    await expect(page.getByText("Multi-Period Import Complete")).toBeVisible();

    await page.getByRole("link", { name: "View Member Results" }).click();
    await page.waitForURL((url) => url.searchParams.has("periodId"));
    expect(page.url()).toMatch(/\/members\?periodId=/);
    await expect(page.getByText("SpreadsheetHero")).toBeVisible();
  });

  test("warmed client navigation shows post-import upload state after Continue Setup", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });

    await page.goto(`/alliances/${allianceId}/setup/import`);
    await expect(page.getByText("Import members first")).toBeVisible();

    await page.getByRole("link", { name: "Import Members" }).click();
    await expect(page.getByRole("heading", { name: "Member Import" })).toBeVisible();

    const rosterCsv = "Player,THP\nSetupHero,100000000";
    await page.locator('input[type="file"]').setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(rosterCsv),
    });
    await page.getByRole("button", { name: /Import .* Member/i }).click();
    await expect(page.getByText("Committed Alliance Member Translation")).toBeVisible();

    await page.getByRole("link", { name: "Continue Setup" }).click();
    await expect(page).toHaveURL(`/alliances/${allianceId}/setup/import`);
    await expect(page.getByText("Import members first")).not.toBeVisible();
    await expect(
      page.getByText(/Import evaluation results from your spreadsheet/i),
    ).toBeVisible();
  });

  test("manual fallback journey: anchor scroll, task order, and blocked data task", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/setup`);

    await page.getByRole("link", { name: "Set up manually" }).click();
    await expect(page.locator("#manual-setup")).toBeInViewport();

    const requiredSection = page.locator("#manual-setup");
    const taskLabels = await requiredSection
      .locator(".font-medium")
      .allTextContents();

    const orderedRequired = taskLabels.filter((label) =>
      [
        "Create Evaluation Period",
        "Configure Metrics",
        "Import Members",
        "Import Evaluation Results",
      ].includes(label),
    );
    expect(orderedRequired).toEqual([
      "Create Evaluation Period",
      "Configure Metrics",
      "Import Members",
      "Import Evaluation Results",
    ]);

    await expect(page.getByText("Invite Leadership Team")).toBeVisible();
    await expect(page.getByText(DATA_BLOCKED_BY_MEMBERS)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Import Evaluation Results/i }),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: "Import Members →" })
      .click();
    await expect(page).toHaveURL(`/alliances/${allianceId}/members/import`);
  });

  test("leader without IMPORT_MEMBERS sees consistent blocked explanation", async ({
    page,
    login,
    leaderScenario,
  }) => {
    const { allianceId, email, password } = leaderScenario;

    await login({ email, password, displayName: "Leader User" });
    await page.goto(`/alliances/${allianceId}/setup`);

    await expect(page.getByText(DATA_BLOCKED_BY_MEMBERS)).toBeVisible();
    await expect(page.getByRole("link", { name: "Import Members →" })).toHaveCount(0);

    await page.goto(`/alliances/${allianceId}/setup/import`);
    await expect(page.getByText("Import members first")).toBeVisible();
    await expect(page.getByText(/Ask an Admin or Owner/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Import Members" })).toHaveCount(0);
  });

  test("setup entry choice is keyboard reachable", async ({ page, login, adminScenario }) => {
    const { allianceId, email, password } = adminScenario;

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/setup`);

    const manualLink = page.getByRole("link", { name: "Set up manually" });

    let focusedHref = "";
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      focusedHref =
        (await page.evaluate(() =>
          document.activeElement instanceof HTMLAnchorElement
            ? document.activeElement.href
            : "",
        )) ?? "";
      if (focusedHref.endsWith(`/alliances/${allianceId}/setup/import`)) {
        break;
      }
    }
    expect(focusedHref).toContain(`/alliances/${allianceId}/setup/import`);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/alliances/${allianceId}/setup/import`);

    await page.goto(`/alliances/${allianceId}/setup`);
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      const href = await page.evaluate(() =>
        document.activeElement instanceof HTMLAnchorElement
          ? document.activeElement.getAttribute("href")
          : null,
      );
      if (href === "#manual-setup") {
        break;
      }
    }
    await expect(manualLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#manual-setup")).toBeInViewport();
  });

  test("setup entry choice and checklist remain usable on a narrow viewport", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;

    await page.setViewportSize({ width: 390, height: 844 });
    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/setup`);

    await expect(
      page.getByRole("link", { name: "Start with a spreadsheet" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Set up manually" })).toBeVisible();
    await expect(page.locator("#manual-setup")).toBeAttached();
    await expect(page.getByText("Create Evaluation Period")).toBeVisible();
  });
});
