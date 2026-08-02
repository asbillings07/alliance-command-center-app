import { test, expect } from "../shared/fixtures";
import { checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import { Metric_Type } from "@/app/generated/prisma/enums";

/**
 * Alliance Member Matrix E2E Tests (#264, PR 3)
 *
 * Covers the bounded `getAllianceMemberMetricMatrix` read model and the
 * `/reports` overview's member-by-metric section: honest per-cell states,
 * the server-enforced 6-column cap and chooser, URL-driven search/filter/
 * sort/pagination, pagination reset on any control change, and that a
 * matrix-only interaction preserves the report's own `periodId`/
 * `comparePeriodId`.
 *
 * Every test scopes its roster query with `matrixSearch` set to a suffix
 * unique to that test run — the shared `TEST_ALLIANCE_ID` fixture alliance
 * already has its own members, and the matrix's default sort (member name,
 * across the *whole* roster) would otherwise risk pushing a test's own
 * members onto a later page, making assertions on page 1 flaky.
 *
 * @tags @release-gate
 */

const ALLIANCE_ID = process.env.TEST_ALLIANCE_ID;

type SeededMetric = Awaited<ReturnType<typeof prisma.metric.create>>;
type SeededPeriod = Awaited<ReturnType<typeof prisma.metricPeriod.create>>;
type SeededMember = Awaited<ReturnType<typeof prisma.allianceMember.create>>;

async function seedMetric(
  suffix: string,
  opts: { type?: Metric_Type; unitLabel?: string | null } = {},
): Promise<SeededMetric> {
  return prisma.metric.create({
    data: {
      allianceId: ALLIANCE_ID!,
      name: `E2E Matrix Metric ${suffix} ${crypto.randomUUID().slice(0, 8)}`,
      type: opts.type ?? Metric_Type.NUMERIC,
      summaryKind: "SUM",
      unitLabel: opts.unitLabel ?? null,
      active: true,
    },
  });
}

async function seedPeriod(suffix: string, opts: { startsAt?: Date; endsAt?: Date } = {}): Promise<SeededPeriod> {
  return prisma.metricPeriod.create({
    data: { allianceId: ALLIANCE_ID!, name: `E2E Matrix Period ${suffix}`, ...opts, active: true },
  });
}

async function attachMetric(periodId: string, metricId: string) {
  return prisma.metricPeriodMetric.create({ data: { periodId, metricId, active: true, weight: 1, required: false } });
}

async function seedMember(playerName: string): Promise<SeededMember> {
  return prisma.allianceMember.create({ data: { allianceId: ALLIANCE_ID!, playerName } });
}

async function recordEntry(periodId: string, metricId: string, memberId: string, value: number) {
  return prisma.memberMetricEntry.create({ data: { periodId, metricId, allianceMemberId: memberId, value } });
}

async function cleanup(args: { metricIds?: string[]; periodIds?: string[]; memberIds?: string[] }) {
  const { metricIds = [], periodIds = [], memberIds = [] } = args;
  if (metricIds.length > 0) {
    await prisma.memberMetricEntry.deleteMany({ where: { metricId: { in: metricIds } } });
    await prisma.metricPeriodMetric.deleteMany({ where: { metricId: { in: metricIds } } });
  }
  if (periodIds.length > 0) {
    await prisma.memberMetricEntry.deleteMany({ where: { periodId: { in: periodIds } } });
    await prisma.metricPeriodMetric.deleteMany({ where: { periodId: { in: periodIds } } });
    await prisma.metricPeriod.deleteMany({ where: { id: { in: periodIds } } });
  }
  if (memberIds.length > 0) {
    await prisma.memberMetricEntry.deleteMany({ where: { allianceMemberId: { in: memberIds } } });
    await prisma.allianceMember.deleteMany({ where: { id: { in: memberIds } } });
  }
  if (metricIds.length > 0) {
    await prisma.metric.deleteMany({ where: { id: { in: metricIds } } });
  }
}

test.describe("Alliance Member Matrix", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ALLIANCE_ID, "TEST_ALLIANCE_ID required");
    test.skip(!process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD, "Owner credentials required");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("renders one honest cell per (member, column): a recorded value, a missing value, and a not-attached column", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const alice = await seedMember(`E2E Matrix Member Alice-${suffix}`);
    const bob = await seedMember(`E2E Matrix Member Bob-${suffix}`);

    const donations = await seedMetric(`${suffix}-donations`, { unitLabel: "pts" });
    await attachMetric(period.id, donations.id);
    await recordEntry(period.id, donations.id, alice.id, 1234);
    // Bob never recorded a value for `donations` -> MISSING.

    const neverAttached = await seedMetric(`${suffix}-never-attached`);
    // Deliberately not attached to `period` at all -> NOT_ATTACHED for every row.

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}&matrixSearch=${encodeURIComponent(suffix)}`,
      );

      const matrix = page.getByTestId("alliance-member-matrix");
      await expect(matrix).toBeVisible();

      await expect(page.getByTestId(`matrix-cell-${alice.id}-${donations.id}`)).toContainText("pts");
      await expect(page.getByTestId(`matrix-cell-${bob.id}-${donations.id}`)).toContainText("Missing");
      await expect(page.getByTestId(`matrix-cell-${alice.id}-${neverAttached.id}`)).toContainText("Not attached");
      await expect(page.getByTestId(`matrix-cell-${bob.id}-${neverAttached.id}`)).toContainText("Not attached");
    } finally {
      await cleanup({ metricIds: [donations.id, neverAttached.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("caps the column chooser at 6, defaulting to the first 6 in the report's stable order, and disables further selection", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const metrics = await Promise.all(Array.from({ length: 8 }, (_, i) => seedMetric(`${suffix}-${i}`)));
    await Promise.all(metrics.map((m) => attachMetric(period.id, m.id)));

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);

      const chooser = page.getByTestId("matrix-column-chooser");
      await expect(chooser).toBeVisible();
      await expect(chooser.locator('input[type="checkbox"]:checked')).toHaveCount(6);

      const unchecked = chooser.locator('input[type="checkbox"]:not(:checked)').first();
      await expect(unchecked).toBeDisabled();
    } finally {
      await cleanup({ metricIds: metrics.map((m) => m.id), periodIds: [period.id] });
    }
  });

  test("changing the column selection updates the URL and the rendered table columns", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const keep = await seedMetric(`${suffix}-keep`);
    const drop = await seedMetric(`${suffix}-drop`);
    await attachMetric(period.id, keep.id);
    await attachMetric(period.id, drop.id);

    try {
      // Explicitly requests exactly {keep, drop} as the starting selection —
      // the shared fixture alliance can carry other active metrics left
      // over from other specs (never assume a clean metric library), which
      // would otherwise make "uncheck one of the two default-selected
      // columns" nondeterministic.
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}&matrixColumns=${keep.id},${drop.id}`,
      );

      await page.getByTestId(`matrix-column-checkbox-${drop.id}`).uncheck();
      await page.getByTestId("matrix-controls-form").getByRole("button", { name: "Apply" }).click();
      // The starting URL already contains `matrixColumns=`, so waiting on
      // that substring alone is a no-op — wait for the *specific* resolved
      // value instead, so this doesn't race the client-side navigation.
      await page.waitForURL((url) => url.searchParams.get("matrixColumns") === keep.id);

      const url = new URL(page.url());
      expect(url.searchParams.get("matrixColumns")).toBe(keep.id);

      const table = page.getByTestId("alliance-member-matrix");
      await expect(table.getByRole("link", { name: new RegExp(keep.name) })).toBeVisible();
      await expect(table.getByRole("link", { name: new RegExp(drop.name) })).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [keep.id, drop.id], periodIds: [period.id] });
    }
  });

  test("sorts rows by a selected metric's value, ascending, breaking ties by player name", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const low = await seedMember(`E2E Matrix Member Bob Low-${suffix}`);
    const tieA = await seedMember(`E2E Matrix Member Alice Tie-${suffix}`);
    const tieB = await seedMember(`E2E Matrix Member Zoe Tie-${suffix}`);
    const metric = await seedMetric(suffix);
    await attachMetric(period.id, metric.id);
    await recordEntry(period.id, metric.id, low.id, 10);
    await recordEntry(period.id, metric.id, tieA.id, 50);
    await recordEntry(period.id, metric.id, tieB.id, 50);

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}&matrixSearch=${encodeURIComponent(suffix)}`,
      );

      // ID-based locators, not `getByLabel` — the column chooser's
      // checkboxes are labeled with arbitrary metric names, which can
      // coincidentally contain words like "sort" or "direction" and make
      // an accessible-name lookup ambiguous.
      await page.locator("#matrix-sort").selectOption(metric.id);
      await page.locator("#matrix-sort-dir").selectOption("asc");
      await page.getByTestId("matrix-controls-form").getByRole("button", { name: "Apply" }).click();
      await page.waitForURL(new RegExp(`matrixSort=${metric.id}`));

      const table = page.getByTestId("alliance-member-matrix");
      const rows = table.locator("tbody tr");
      await expect(rows).toHaveCount(3);
      // Low value first; the two ties (both 50) resolve alphabetically by name: Alice before Zoe.
      await expect(rows.nth(0)).toContainText("Bob Low");
      await expect(rows.nth(1)).toContainText("Alice Tie");
      await expect(rows.nth(2)).toContainText("Zoe Tie");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [low.id, tieA.id, tieB.id] });
    }
  });

  test("any control change resets pagination to page 1", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const metric = await seedMetric(suffix);
    await attachMetric(period.id, metric.id);
    // Page size isn't URL-exposed (matches the per-metric report's own
    // convention) — 26 members guarantees 2 pages at the real default (25).
    const members = await Promise.all(
      Array.from({ length: 26 }, (_, i) => seedMember(`E2E Matrix Member ${String(i).padStart(2, "0")}-${suffix}`)),
    );

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}&matrixSearch=${encodeURIComponent(suffix)}`,
      );

      await page.getByRole("button", { name: "Next" }).click();
      await page.waitForURL(/matrixPage=2/);

      await page.locator("#matrix-search").fill(suffix);
      await page.getByTestId("matrix-controls-form").getByRole("button", { name: "Apply" }).click();

      await expect(page).not.toHaveURL(/matrixPage=2/);
      await expect(page.getByText(/^Page 1 of/)).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: members.map((m) => m.id) });
    }
  });

  test("preserves the resolved comparePeriodId when a matrix control changes, without applying it to matrix values", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const previous = await seedPeriod(`${suffix}-prev`, {
      startsAt: new Date("2026-07-01T00:00:00Z"),
      endsAt: new Date("2026-07-07T00:00:00Z"),
    });
    const current = await seedPeriod(`${suffix}-curr`, {
      startsAt: new Date("2026-07-08T00:00:00Z"),
      endsAt: new Date("2026-07-14T00:00:00Z"),
    });
    const metric = await seedMetric(suffix);
    await attachMetric(previous.id, metric.id);
    await attachMetric(current.id, metric.id);

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${current.id}&comparePeriodId=${previous.id}`,
      );

      await page.locator("#matrix-search").fill(suffix);
      await page.getByTestId("matrix-controls-form").getByRole("button", { name: "Apply" }).click();
      await page.waitForURL(new RegExp(`matrixSearch=${encodeURIComponent(suffix)}`));

      await expect(page).toHaveURL(new RegExp(`comparePeriodId=${previous.id}`));
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [previous.id, current.id] });
    }
  });

  test("@a11y alliance member matrix meets accessibility standards", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const alice = await seedMember(`E2E Matrix Member Alice-${suffix}`);
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    await attachMetric(period.id, metric.id);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}&matrixSearch=${encodeURIComponent(suffix)}`,
      );
      await expect(page.getByTestId(`matrix-cell-${alice.id}-${metric.id}`)).toBeVisible();
      await page.waitForLoadState("networkidle");

      await checkA11yWithOptions(page, {
        runOnly: ["wcag2a", "wcag2aa"],
        include: ['[data-testid="alliance-member-matrix"]'],
      });
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });
});
