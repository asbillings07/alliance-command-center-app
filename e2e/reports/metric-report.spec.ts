import { test, expect } from "../shared/fixtures";
import { checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";

/**
 * Metric Summary Report E2E Tests (#190)
 *
 * The report is generic per-metric — VS Score, Donations, Battle
 * Participation, or anything else configured by the alliance all render
 * through the same page, driven by `Metric.summaryKind`. Each test seeds
 * its own Metric/MetricPeriod/AllianceMember/MemberMetricEntry rows scoped
 * to the shared `TEST_ALLIANCE_ID` fixture alliance and cleans them up in a
 * `finally` block, following the platform Access Request queue's
 * self-seeding pattern rather than depending on brittle pre-existing
 * fixture data.
 *
 * @tags @release-gate
 */

const ALLIANCE_ID = process.env.TEST_ALLIANCE_ID;
const OTHER_ALLIANCE_ID = process.env.TEST_OTHER_ALLIANCE_ID;

type SeededMetric = Awaited<ReturnType<typeof prisma.metric.create>>;
type SeededPeriod = Awaited<ReturnType<typeof prisma.metricPeriod.create>>;
type SeededMember = Awaited<ReturnType<typeof prisma.allianceMember.create>>;

async function seedMetric(
  suffix: string,
  opts: {
    type?: Metric_Type;
    summaryKind?: MetricSummaryKind;
    unitLabel?: string | null;
    allianceId?: string;
  } = {},
): Promise<SeededMetric> {
  return prisma.metric.create({
    data: {
      allianceId: opts.allianceId ?? ALLIANCE_ID!,
      // Metric.name is unique per alliance. `suffix` alone (usually
      // Date.now()+retry) can collide across parallel/rapid test runs in the
      // same millisecond; the random component keeps names unique while
      // `suffix` stays a stable substring for search/filter assertions.
      name: `E2E Report Metric ${suffix} ${crypto.randomUUID().slice(0, 8)}`,
      type: opts.type ?? Metric_Type.NUMERIC,
      summaryKind: opts.summaryKind ?? MetricSummaryKind.SUM,
      unitLabel: opts.unitLabel ?? null,
    },
  });
}

async function seedPeriod(
  suffix: string,
  opts: { startsAt?: Date; endsAt?: Date; active?: boolean; allianceId?: string } = {},
): Promise<SeededPeriod> {
  return prisma.metricPeriod.create({
    data: {
      allianceId: opts.allianceId ?? ALLIANCE_ID!,
      name: `E2E Report Period ${suffix}`,
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
      active: opts.active ?? true,
    },
  });
}

async function attachMetric(periodId: string, metricId: string, active = true) {
  return prisma.metricPeriodMetric.create({
    data: { periodId, metricId, active, weight: 1, required: false },
  });
}

async function seedMember(suffix: string, opts: { archived?: boolean; allianceId?: string } = {}): Promise<SeededMember> {
  return prisma.allianceMember.create({
    data: {
      allianceId: opts.allianceId ?? ALLIANCE_ID!,
      // AllianceMember.playerName is unique per alliance; see the matching
      // comment on seedMetric above for why the random component is needed.
      playerName: `E2E Report Member ${suffix} ${crypto.randomUUID().slice(0, 8)}`,
      archivedAt: opts.archived ? new Date("2026-01-01") : null,
    },
  });
}

async function recordEntry(periodId: string, metricId: string, memberId: string, value: number, recordedAt?: Date) {
  return prisma.memberMetricEntry.create({
    data: { periodId, metricId, allianceMemberId: memberId, value, recordedAt: recordedAt ?? new Date() },
  });
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

test.describe("Metric Summary Report", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ALLIANCE_ID, "TEST_ALLIANCE_ID required");
    test.skip(!process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD, "Owner credentials required");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("SUM metric: shows the alliance total, ranking, and per-member share of total", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 300);
    await recordEntry(period.id, metric.id, bob.id, 100);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("rollup-headline")).toContainText("400");
      await expect(page.getByTestId(`report-row-${alice.id}`)).toContainText("75%");
      await expect(page.getByTestId(`report-row-${bob.id}`)).toContainText("25%");
      await expect(page.getByTestId(`report-row-${alice.id}`)).toContainText("#1");
      await expect(page.getByTestId(`report-row-${bob.id}`)).toContainText("#2");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("AVERAGE metric: shows the alliance average and each member's difference from it", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { summaryKind: MetricSummaryKind.AVERAGE });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 80);
    await recordEntry(period.id, metric.id, bob.id, 40);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("rollup-headline")).toContainText("60");
      await expect(page.getByTestId(`report-row-${alice.id}`)).toContainText("+20");
      await expect(page.getByTestId(`report-row-${bob.id}`)).toContainText("-20");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("TRUE_RATE metric: shows yes/no counts and rate, excluding a legacy invalid value", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    const carol = await seedMember(`Carol-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 1);
    await recordEntry(period.id, metric.id, bob.id, 0);
    // A legacy out-of-range value, bypassing app-level validation directly at
    // the DB layer to simulate pre-#190 data that write-path validation now
    // rejects going forward.
    await recordEntry(period.id, metric.id, carol.id, 2);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("rollup-headline")).toContainText("50%");
      await expect(page.getByText("1 yes / 1 no")).toBeVisible();
      await expect(page.getByTestId("rollup-invalid-note")).toContainText("1 legacy invalid value excluded");
      await expect(page.getByTestId(`report-row-${alice.id}`)).toContainText("Yes");
      await expect(page.getByTestId(`report-row-${bob.id}`)).toContainText("No");
      await expect(page.getByTestId(`report-row-${carol.id}`)).toContainText("Invalid");
      await expect(page.getByTestId("coverage-invalid-note")).toBeVisible();
      // TRUE_RATE's contract is yes/no counts and rate, not ranking.
      await expect(page.getByRole("columnheader", { name: "Rank" })).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id, carol.id] });
    }
  });

  test("NONE-kind metric: shows per-member values and coverage without an alliance-wide rollup card", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { summaryKind: MetricSummaryKind.NONE });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 55);
    // The shared fixture alliance already has its own active members
    // (review feedback precedent: never assume a clean database) — the
    // coverage denominator is however many active members it happens to
    // have right now, not just the one this test just seeded.
    const currentActiveMemberCount = await prisma.allianceMember.count({
      where: { allianceId: ALLIANCE_ID, archivedAt: null },
    });

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("rollup-headline")).toHaveCount(0);
      await expect(page.getByTestId(`report-row-${alice.id}`)).toContainText("55");
      // NONE's contract includes ranking even for a (hypothetically) BOOLEAN
      // metric — this NUMERIC case at least confirms the column isn't
      // dropped just because there's no alliance-wide rollup.
      await expect(page.getByTestId(`report-row-${alice.id}`)).toContainText("#1");
      await expect(page.getByText(new RegExp(`1 of ${currentActiveMemberCount} current active members`))).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("shows a period-over-period comparison against the nearest eligible prior period", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    // `isEligibleComparisonPeriod` requires candidate.endsAt strictly before
    // selected.startsAt (a shared boundary instant counts as overlapping,
    // not preceding) — end previous exactly 1ms before current starts, and
    // keep both spans the same duration.
    const previous = await seedPeriod(`${suffix}-prev`, {
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-07T23:59:59.999Z"),
    });
    const current = await seedPeriod(`${suffix}-curr`, {
      startsAt: new Date("2026-01-08T00:00:00.000Z"),
      endsAt: new Date("2026-01-14T23:59:59.999Z"),
    });
    await attachMetric(previous.id, metric.id);
    await attachMetric(current.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(previous.id, metric.id, alice.id, 100);
    await recordEntry(current.id, metric.id, alice.id, 150);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${current.id}`);

      await expect(page.getByTestId("rollup-change")).toContainText("+50");
      await expect(page.getByTestId("rollup-change")).toContainText("+50%");
      await expect(page.getByTestId("rollup-change")).toContainText(previous.name);
      await expect(page.getByTestId("compare-period-select")).toHaveValue(previous.id);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [previous.id, current.id], memberIds: [alice.id] });
    }
  });

  test("an invalid comparePeriodId shows a recovery banner with a recommended period", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const previous = await seedPeriod(`${suffix}-prev`, {
      startsAt: new Date("2026-02-01T00:00:00.000Z"),
      endsAt: new Date("2026-02-07T23:59:59.999Z"),
    });
    const current = await seedPeriod(`${suffix}-curr`, {
      startsAt: new Date("2026-02-08T00:00:00.000Z"),
      endsAt: new Date("2026-02-14T23:59:59.999Z"),
    });
    const unrelated = await seedPeriod(`${suffix}-unrelated`);
    await attachMetric(previous.id, metric.id);
    await attachMetric(current.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(previous.id, metric.id, alice.id, 100);
    await recordEntry(current.id, metric.id, alice.id, 150);

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${current.id}&comparePeriodId=${unrelated.id}`,
      );

      await expect(page.getByTestId("comparison-invalid-banner")).toBeVisible();
      const recommendedButton = page.getByTestId("comparison-use-recommended");
      await expect(recommendedButton).toContainText(previous.name);
      await recommendedButton.click();
      await page.waitForURL(new RegExp(`comparePeriodId=${previous.id}`));
      await expect(page.getByTestId("rollup-change")).toContainText("+50");
    } finally {
      await cleanup({
        metricIds: [metric.id],
        periodIds: [previous.id, current.id, unrelated.id],
        memberIds: [alice.id],
      });
    }
  });

  test("NOT_ATTACHED period shows guidance instead of a fabricated empty report", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const attachedPeriod = await seedPeriod(`${suffix}-attached`);
    const unattachedPeriod = await seedPeriod(`${suffix}-unattached`);
    await attachMetric(attachedPeriod.id, metric.id);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${unattachedPeriod.id}`);

      await expect(page.getByTestId("attachment-status-badge")).toContainText("Not attached");
      await expect(page.getByTestId("not-attached-message")).toContainText(unattachedPeriod.name);
      await expect(page.getByRole("link", { name: /attach it to this period/i })).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [attachedPeriod.id, unattachedPeriod.id], memberIds: [] });
    }
  });

  test("an attached period with zero recorded results shows a no-data empty state with a Record CTA", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByText(new RegExp(`No results recorded yet for ${period.name}`))).toBeVisible();
      await expect(page.getByRole("link", { name: /record now/i })).toBeVisible();
      await expect(page.getByTestId("rollup-headline")).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("a metric never attached to any period shows a dedicated empty state, not a crash", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}`);

      await expect(page.getByText(/not attached to any evaluation period yet/i)).toBeVisible();
      await expect(page.getByRole("link", { name: /go to evaluation periods/i })).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id] });
    }
  });

  test("search, filter, sort, and pagination round-trip via URL params", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const zed = await seedMember(`Zed-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 10);
    await recordEntry(period.id, metric.id, zed.id, 90);

    try {
      // Search narrows the roster to just this test's two seeded members —
      // both names embed `suffix` — so rank/order assertions below can't be
      // thrown off by the shared fixture alliance's other active members
      // (whose names aren't controlled by this test).
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}&search=${suffix}`,
      );

      // Default sort (value_desc): Zed (90) ranks above Alice (10). Scoped to
      // `tr` to exclude the mobile card layout, whose
      // `report-row-card-{id}` testid also matches this prefix.
      const rows = page.locator("tr[data-testid^='report-row-']");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveAttribute("data-testid", `report-row-${zed.id}`);

      // Sort by name instead: Alice sorts before Zed alphabetically,
      // reversing the default value-based order above.
      await page.getByLabel(/sort/i).selectOption("name_asc");
      await page.getByRole("button", { name: /apply/i }).click();
      await page.waitForURL(/sort=name_asc/);
      await expect(rows.first()).toHaveAttribute("data-testid", `report-row-${alice.id}`);

      // Narrowing the search further to only Alice's name excludes Zed.
      await page.getByLabel(/search/i).fill(`Alice-${suffix}`);
      await page.getByRole("button", { name: /apply/i }).click();
      await page.waitForURL(/search=Alice/);
      await expect(page.getByTestId(`report-row-${alice.id}`)).toBeVisible();
      await expect(page.getByTestId(`report-row-${zed.id}`)).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, zed.id] });
    }
  });

  test("an out-of-range page number clamps to the last valid page instead of showing an empty result", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 10);

    try {
      // Only one page of results exists, but the URL asks for page 999.
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}&page=999`);

      await expect(page.getByText(/page 1 of 1/i)).toBeVisible();
      await expect(page.getByTestId(`report-row-${alice.id}`)).toBeVisible();
      await expect(page.getByTestId("report-no-rows")).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("Next/Previous pagination actually moves between pages and preserves the other URL params", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);

    // 26 members (default page size is 25) whose names all embed `suffix`,
    // sortable by a zero-padded index, so a search for `suffix` isolates
    // exactly this test's own roster into 2 real pages — independent of
    // however many other active members the shared fixture alliance has.
    const memberNames = Array.from({ length: 26 }, (_, i) => `Page-${String(i + 1).padStart(2, "0")}-${suffix}`);
    const members = await Promise.all(memberNames.map((name) => seedMember(name)));
    await Promise.all(members.map((m) => recordEntry(period.id, metric.id, m.id, 1)));
    const memberIds = members.map((m) => m.id);
    const firstMember = members[0]!;
    const lastMember = members[members.length - 1]!;

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}&search=${suffix}&sort=name_asc`,
      );

      // Scoped to the report page (not `exact`-matched by accessible name
      // alone): a dev-only "Open Next.js Dev Tools" button also matches an
      // unscoped, non-exact getByRole("button", { name: "Next" }).
      const reportPage = page.getByTestId("metric-report-page");
      await expect(page.getByText(/page 1 of 2 \(26 members\)/i)).toBeVisible();
      await expect(page.getByTestId(`report-row-${firstMember.id}`)).toBeVisible();
      await expect(page.getByTestId(`report-row-${lastMember.id}`)).toHaveCount(0);
      await expect(reportPage.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();

      await reportPage.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForURL(/page=2/);
      // The search/sort params applied before paginating must survive the
      // page change, not just the page number itself.
      expect(page.url()).toContain(`search=${suffix}`);
      expect(page.url()).toContain("sort=name_asc");
      await expect(page.getByText(/page 2 of 2 \(26 members\)/i)).toBeVisible();
      await expect(page.getByTestId(`report-row-${lastMember.id}`)).toBeVisible();
      await expect(page.getByTestId(`report-row-${firstMember.id}`)).toHaveCount(0);
      await expect(reportPage.getByRole("button", { name: "Next", exact: true })).toBeDisabled();

      await reportPage.getByRole("button", { name: "Previous", exact: true }).click();
      await page.waitForURL(/page=1/);
      await expect(page.getByTestId(`report-row-${firstMember.id}`)).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds });
    }
  });

  test("an archived member's filter is independent of the alliance total: hidden by the active filter, visible under archived/all, and reconciled by a note", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const zed = await seedMember(`Zed-${suffix}`, { archived: true });
    await recordEntry(period.id, metric.id, alice.id, 10);
    await recordEntry(period.id, metric.id, zed.id, 90);

    try {
      // Default filter is active members: the alliance total honestly
      // includes Zed's contribution even though the active-only roster
      // below doesn't show her row, and the coverage card says so.
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("rollup-headline")).toContainText("100");
      await expect(page.getByTestId(`report-row-${alice.id}`)).toBeVisible();
      await expect(page.getByTestId(`report-row-${zed.id}`)).toHaveCount(0);
      await expect(page.getByTestId("archived-contributors-note")).toContainText("1 archived contributor");

      // Switching to the archived filter surfaces Zed instead of Alice.
      await page.getByLabel(/roster/i).selectOption("archived");
      await page.getByRole("button", { name: /apply/i }).click();
      await page.waitForURL(/filter=archived/);
      await expect(page.getByTestId(`report-row-${zed.id}`)).toBeVisible();
      await expect(page.getByTestId(`report-row-${alice.id}`)).toHaveCount(0);

      // The "all" filter shows both, and the reconciliation note disappears
      // since nothing is hidden by the filter anymore.
      await page.getByLabel(/roster/i).selectOption("all");
      await page.getByRole("button", { name: /apply/i }).click();
      await page.waitForURL(/filter=all/);
      await expect(page.getByTestId(`report-row-${alice.id}`)).toBeVisible();
      await expect(page.getByTestId(`report-row-${zed.id}`)).toBeVisible();
      await expect(page.getByTestId("archived-contributors-note")).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, zed.id] });
    }
  });

  test("an inactive attachment with no recorded values offers reactivation guidance, not a dead-end Record Now link", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id, /* active */ false);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("attachment-status-badge")).toContainText("Inactive attachment");
      await expect(page.getByRole("heading", { name: /is inactive/i })).toBeVisible();
      // The record/import flows only ever target active attachments, so
      // offering them here would be a dead end — the fix is reactivating
      // the attachment itself.
      await expect(page.getByRole("link", { name: /record now/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /import results/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /reactivate this attachment/i })).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id] });
    }
  });

  test("an empty selected period compared against a populated prior period shows NO_DATA_IN_SELECTED_PERIOD, not a fabricated decline", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const previous = await seedPeriod(`${suffix}-prev`, {
      startsAt: new Date("2026-03-01T00:00:00.000Z"),
      endsAt: new Date("2026-03-07T23:59:59.999Z"),
    });
    const current = await seedPeriod(`${suffix}-curr`, {
      startsAt: new Date("2026-03-08T00:00:00.000Z"),
      endsAt: new Date("2026-03-14T23:59:59.999Z"),
    });
    await attachMetric(previous.id, metric.id);
    await attachMetric(current.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(previous.id, metric.id, alice.id, 100);
    // No entries recorded in `current` — its dataStatus is NO_VALUES even
    // though the eligible comparison period has data.

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${current.id}`);

      await expect(page.getByTestId("rollup-headline")).toHaveCount(0);
      await expect(page.getByTestId("comparison-no-data-in-selected-period-banner")).toContainText(previous.name);
      // Never a fabricated "-100%"/decline badge alongside the empty state.
      await expect(page.getByTestId("rollup-change")).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [previous.id, current.id], memberIds: [alice.id] });
    }
  });

  test("a metric belonging to another alliance 404s instead of leaking cross-tenant data", async ({ page }, testInfo) => {
    test.skip(!OTHER_ALLIANCE_ID, "TEST_OTHER_ALLIANCE_ID required");
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const otherMetric = await seedMetric(suffix, { allianceId: OTHER_ALLIANCE_ID! });

    try {
      const response = await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${otherMetric.id}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(/could not be found/i)).toBeVisible();
    } finally {
      await cleanup({ metricIds: [otherMetric.id] });
    }
  });

  test("the Reports index lists configured metrics and links to their reports", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    // Explicit period + periodId so this test doesn't depend on which
    // period the shared fixture alliance happens to default to (#264's
    // alliance overview replaced the old flat metric list here — the
    // per-metric universe is now period-scoped).
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);

      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
      // Scoped to this test's own seeded metric's card — the shared fixture
      // alliance can have other metrics, so ".first()" on an unscoped "View
      // Report" locator could silently click a different metric's link.
      const card = page.getByTestId(`alliance-metric-card-${metric.id}`);
      await expect(card).toContainText(metric.name);
      await card.getByRole("link", { name: "View Report" }).click();
      await page.waitForURL(new RegExp(`/reports/metrics/${metric.id}`));
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id] });
    }
  });

  test("discovery: dashboard Reports card and Metrics Library View Report link both reach the report page", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    // Attached (rather than never-attached) so the destination renders the
    // full report page — the never-attached empty state is already covered
    // by its own dedicated test above.
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}`);
      await page.getByRole("link", { name: "View Reports" }).click();
      await page.waitForURL(/\/reports$/);

      await page.goto(`/alliances/${ALLIANCE_ID}/metrics`);
      const metricCard = page.getByTestId(`metric-card-${metric.id}`);
      await metricCard.getByRole("link", { name: "View Report" }).click();
      await page.waitForURL(new RegExp(`/reports/metrics/${metric.id}`));
      await expect(page.getByTestId("metric-report-page")).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id] });
    }
  });

  test("renders the roster as mobile cards at a narrow viewport", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId(`report-row-card-${alice.id}`)).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("@a11y metric report page meets accessibility standards", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);
      await page.waitForLoadState("networkidle");

      await checkA11yWithOptions(page, {
        runOnly: ["wcag2a", "wcag2aa"],
        include: ['[data-testid="metric-report-page"]'],
      });
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("@visual Metric Report visual snapshot", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);
      await page.waitForLoadState("networkidle");

      // Mask the metric/period names (unique per test run) and everything
      // whose count depends on the shared fixture alliance's *current*
      // active roster (coverage numbers, member table rows) rather than
      // just this test's own seeded data — keep the stable page chrome and
      // card structure in the diff.
      await expect(page).toHaveScreenshot("metric-report.png", {
        fullPage: true,
        animations: "disabled",
        mask: [
          page.getByRole("heading", { level: 1 }),
          page.getByTestId("report-period-select"),
          page.getByTestId("metric-coverage-card"),
          page.getByTestId("metric-interpretation-summary-card"),
          page.getByTestId("metric-visual-section"),
          page.getByRole("table"),
        ],
        maxDiffPixelRatio: 0.02,
      });
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });
});

// #264 PR5 — page hierarchy reorder, accessible visual components, and
// mobile behavior for the metric drill-down chart. Each test seeds its own
// data (same pattern as the suite above) so it's independent of the shared
// fixture alliance's current roster.
test.describe("Metric Drill-Down Charts (#264 PR5)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ALLIANCE_ID, "TEST_ALLIANCE_ID required");
    test.skip(!process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD, "Owner credentials required");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("the page hierarchy places 'What This Tells You' and the chart between Coverage and Members", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const headings = await page.locator("h2").allTextContents();
      const coverageIndex = headings.indexOf("Coverage");
      const tellsYouIndex = headings.indexOf("What This Tells You");
      const membersIndex = headings.indexOf("Members");
      expect(coverageIndex).toBeGreaterThanOrEqual(0);
      expect(tellsYouIndex).toBeGreaterThan(coverageIndex);
      expect(membersIndex).toBeGreaterThan(tellsYouIndex);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("SUM chart: ranked share bars match model order and expose an accessible data table", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`, { archived: true });
    await recordEntry(period.id, metric.id, alice.id, 300);
    await recordEntry(period.id, metric.id, bob.id, 100);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}&filter=all`);

      const chart = page.getByTestId("sum-share-chart");
      await expect(chart).toBeVisible();
      // Sighted-user graphic is decorative — never independently focusable.
      await expect(page.getByTestId("sum-share-bars")).toHaveAttribute("aria-hidden", "true");

      const rows = chart.locator("[data-testid^='sum-share-row-']");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveAttribute("data-testid", `sum-share-row-${alice.id}`);
      await expect(rows.nth(0)).toContainText("75%");
      await expect(rows.nth(1)).toContainText("Archived");

      // The accessible table equivalent carries the same information.
      const disclosure = chart.locator("details");
      await expect(disclosure).toHaveAttribute("open", "");
      const table = disclosure.locator("table");
      await expect(table).toContainText("75%");
      await expect(table.getByRole("columnheader", { name: "Share of total" })).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("SUM chart: mixed-sign data renders diverging bars with signed values and never a percentage", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 100);
    await recordEntry(period.id, metric.id, bob.id, -40);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const chart = page.getByTestId("sum-diverging-chart");
      await expect(chart).toBeVisible();
      await expect(chart).not.toContainText("%");
      await expect(chart).toContainText("+100 pts");
      await expect(chart).toContainText("-40 pts");
      await expect(chart).toContainText("Adds to total");
      await expect(chart).toContainText("Subtracts from total");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("SUM chart: all-negative data states shares are unavailable, never 'mixed'", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, -25);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const chart = page.getByTestId("sum-diverging-chart");
      await expect(chart).toContainText("All recorded contributions were non-positive; member shares are unavailable.");
      await expect(chart).not.toContainText("Adds to total");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("AVERAGE chart: renders a six-bin histogram with an average marker and exact ranges in the table", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { summaryKind: MetricSummaryKind.AVERAGE, unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const members = await Promise.all(
      [10, 20, 30, 40, 50, 60].map((_, i) => seedMember(`Member-${i}-${suffix}`)),
    );
    await Promise.all(members.map((m, i) => recordEntry(period.id, metric.id, m.id, [10, 20, 30, 40, 50, 60][i]!)));

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const chart = page.getByTestId("average-distribution-chart");
      await expect(chart).toBeVisible();
      await expect(page.getByTestId("average-histogram")).toHaveAttribute("focusable", "false");
      await expect(page.getByTestId("average-histogram-average-marker")).toBeVisible();
      await expect(chart).toContainText("Average 35 pts across 6 valid results.");
      const table = chart.locator("table");
      await expect(table).toContainText("10 pts ≤ value < 18 pts");
      await expect(table).toContainText("52 pts ≤ value ≤ 60 pts");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: members.map((m) => m.id) });
    }
  });

  test("AVERAGE chart: an all-equal cohort renders one centered bar and text, not a zero-width plot", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { summaryKind: MetricSummaryKind.AVERAGE, unitLabel: "points" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 5);
    await recordEntry(period.id, metric.id, bob.id, 5);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      await expect(page.getByTestId("distribution-all-equal-bar")).toBeVisible();
      await expect(page.getByTestId("average-histogram")).toHaveCount(0);
      await expect(page.getByText("All 2 valid results were 5 points.")).toBeVisible();
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("TRUE_RATE chart: renders separate recorded-response and active-roster-coverage bars, with an archived note", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    const zed = await seedMember(`Zed-${suffix}`, { archived: true });
    await recordEntry(period.id, metric.id, alice.id, 1);
    await recordEntry(period.id, metric.id, bob.id, 0);
    await recordEntry(period.id, metric.id, zed.id, 1);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const chart = page.getByTestId("true-rate-breakdown-chart");
      await expect(chart).toBeVisible();
      await expect(page.getByTestId("true-rate-response-bar")).toBeVisible();
      await expect(page.getByTestId("true-rate-coverage-bar")).toBeVisible();
      await expect(chart).toContainText("Recorded response totals include 1 archived contributor; active-roster coverage does not.");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id, zed.id] });
    }
  });

  test("NONE-kind metric chart explicitly denies an alliance-wide rollup for both numeric and boolean types", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const numericMetric = await seedMetric(`${suffix}-numeric`, { summaryKind: MetricSummaryKind.NONE });
    const booleanMetric = await seedMetric(`${suffix}-boolean`, {
      type: Metric_Type.BOOLEAN,
      summaryKind: MetricSummaryKind.NONE,
    });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, numericMetric.id);
    await attachMetric(period.id, booleanMetric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, numericMetric.id, alice.id, 55);
    await recordEntry(period.id, booleanMetric.id, alice.id, 1);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${numericMetric.id}?periodId=${period.id}`);
      await expect(page.getByTestId("none-numeric-distribution-chart")).toContainText(
        "No alliance-wide rollup is defined for this metric.",
      );

      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${booleanMetric.id}?periodId=${period.id}`);
      await expect(page.getByTestId("none-boolean-breakdown-chart")).toContainText(
        "No alliance-wide rollup is defined for this metric.",
      );
    } finally {
      await cleanup({
        metricIds: [numericMetric.id, booleanMetric.id],
        periodIds: [period.id],
        memberIds: [alice.id],
      });
    }
  });

  test("renders the chart at a 320px mobile viewport without horizontal overflow", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`A Very Long Alliance Member Display Name-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const chart = page.getByTestId("sum-share-chart");
      await expect(chart).toBeVisible();
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(320);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });

  test("@a11y metric drill-down chart section meets accessibility standards", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 300);
    await recordEntry(period.id, metric.id, bob.id, 100);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);
      await page.waitForLoadState("networkidle");

      await checkA11yWithOptions(page, {
        runOnly: ["wcag2a", "wcag2aa"],
        include: ['[data-testid="metric-visual-section"]'],
      });
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("no element inside the chart's decorative graphic is keyboard-focusable", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix, { summaryKind: MetricSummaryKind.AVERAGE, unitLabel: "pts" });
    const period = await seedPeriod(suffix);
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 10);
    await recordEntry(period.id, metric.id, bob.id, 90);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${period.id}`);

      const chart = page.getByTestId("average-distribution-chart");
      const graphicWrapper = chart.locator("> div[aria-hidden='true']").first();
      const focusableCount = await graphicWrapper
        .locator("a, button, input, select, textarea, [tabindex]")
        .count();
      expect(focusableCount).toBe(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });
});

// Separate describe block: the suite above's `beforeEach` logs in as Owner,
// which would leave an authenticated session in place when this test then
// tries to reach `/login` as a different user (an already-authenticated
// visit to `/login` redirects away instead of showing the form). This test
// owns its own login instead of inheriting that shared fixture.
test.describe("Metric Summary Report — Viewer permissions", () => {
  test("viewer can view a report read-only, and sees ask-admin guidance instead of a configuration link", async ({
    page,
  }, testInfo) => {
    test.skip(!ALLIANCE_ID, "TEST_ALLIANCE_ID required");
    test.skip(!process.env.TEST_VIEWER_EMAIL || !process.env.TEST_VIEWER_PASSWORD, "Viewer credentials required");
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const metric = await seedMetric(suffix);
    const attachedPeriod = await seedPeriod(`${suffix}-attached`);
    const unattachedPeriod = await seedPeriod(`${suffix}-unattached`);
    await attachMetric(attachedPeriod.id, metric.id);

    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
      await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/(app|alliances)/);

      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${attachedPeriod.id}`);
      await expect(page.getByTestId("metric-report-page")).toBeVisible();
      await expect(page.getByRole("link", { name: /manage metric/i })).toHaveCount(0);
      // This period is ACTIVE + NO_VALUES for the viewer: no Record/Import
      // CTA (viewers lack IMPORT_METRICS), but not a silent dead end either.
      await expect(page.getByRole("link", { name: /record now/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /import results/i })).toHaveCount(0);
      await expect(page.getByText(/ask an admin or owner to record or import results/i)).toBeVisible();

      await page.goto(`/alliances/${ALLIANCE_ID}/reports/metrics/${metric.id}?periodId=${unattachedPeriod.id}`);
      await expect(page.getByTestId("not-attached-message")).toContainText("Ask an Admin or Owner");
      await expect(page.getByRole("link", { name: /attach it to this period/i })).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [attachedPeriod.id, unattachedPeriod.id] });
    }
  });
});
