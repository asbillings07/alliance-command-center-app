import { test, expect } from "../shared/fixtures";

/**
 * Dashboard Workflow Groups E2E Tests (#332 / #192 phase 1)
 *
 * Exercises the `dashboard-workflow-groups`-enabled dashboard. The default
 * E2E run (`npm run test:e2e`) keeps this flag off - matching real
 * off-by-default production - so every test here is skipped unless the
 * suite was started via `npm run test:e2e:dashboard-workflow-groups-on`
 * (see prisma/seed.ts and package.json). CI runs that script as its own
 * job (`.github/workflows/ci.yml` - "Playwright E2E (dashboard-workflow-
 * groups on)"), so a green PR actually exercises this file, not just a
 * local-only escape hatch.
 *
 * That script targets *only this file*, not the full `npm run test:e2e`
 * suite - `dashboard-navigation.spec.ts`, `dashboard-prerequisite-gating.
 * spec.ts`, and several journey/authorization specs assert legacy-only
 * dashboard content (e.g. a "Your Role" card) and are not flag-aware, so
 * forcing the flag on for the whole suite would fail them. If a future
 * change makes those specs flag-aware too, this can be widened - but
 * don't widen the script without auditing every spec that navigates to
 * `/alliances/:id` first.
 */
test.describe("Dashboard Workflow Groups (enabled)", () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.TEST_DASHBOARD_WORKFLOW_GROUPS_ENABLED,
      "Run via `npm run test:e2e:dashboard-workflow-groups-on`",
    );
  });

  test("Owner sees the three phase-1 groups, the role badge, and the no-period Evaluation Results state", async ({
    page,
    ownerScenario,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ownerScenario.email);
    await page.getByLabel(/password/i).fill(ownerScenario.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${ownerScenario.allianceId}`);

    await expect(page.getByRole("heading", { name: "Setup and data freshness" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roster health" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Participation and evaluation" })).toBeVisible();

    // Role now surfaces as a header badge, not a standalone "Your Role" card -
    // labeled "Role: X" so the badge alone doesn't read as something else.
    await expect(page.getByText("Role: OWNER", { exact: true })).toBeVisible();
    await expect(page.getByText(/your role/i)).not.toBeVisible();

    await expect(page.getByRole("link", { name: "Manage Team" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View Members" })).toBeVisible();

    await expect(page.getByText("Evaluation Results")).toBeVisible();
    await expect(page.getByText("No evaluation periods yet")).toBeVisible();
  });

  test("Viewer sees the three groups but no configuration cards", async ({ page }) => {
    test.skip(
      !process.env.TEST_ALLIANCE_ID || !process.env.TEST_VIEWER_EMAIL || !process.env.TEST_VIEWER_PASSWORD,
      "Viewer credentials required",
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${process.env.TEST_ALLIANCE_ID}`);

    await expect(page.getByRole("heading", { name: "Setup and data freshness" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roster health" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Participation and evaluation" })).toBeVisible();

    await expect(page.getByRole("link", { name: "Manage Team" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Manage Metrics" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Manage Periods" })).not.toBeVisible();
    await expect(page.getByText("Evaluation Results")).not.toBeVisible();
  });

  test("wrong-alliance access is still denied when the flag is enabled", async ({ page, ownerScenario }) => {
    test.skip(!process.env.TEST_OTHER_ALLIANCE_ID, "TEST_OTHER_ALLIANCE_ID required");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ownerScenario.email);
    await page.getByLabel(/password/i).fill(ownerScenario.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}`);

    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID!);
  });
});
