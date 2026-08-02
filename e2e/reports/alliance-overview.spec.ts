import { test, expect } from "../shared/fixtures";
import { checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { formatPercent } from "@/app/src/lib/format/formatPercent";

/**
 * Alliance Performance Overview E2E Tests (#264, PR 1)
 *
 * Covers the bulk `getAlliancePerformanceReport` read model and the
 * redesigned `/reports` index: the deterministic metric universe, honest
 * per-metric performance cards across all four summary kinds and every
 * attachment/data state, the shared alliance-wide comparison period, and
 * overall coverage. Each test seeds its own Metric/MetricPeriod/
 * AllianceMember/MemberMetricEntry rows scoped to the shared
 * `TEST_ALLIANCE_ID` fixture alliance and cleans them up in a `finally`
 * block (same self-seeding pattern as `metric-report.spec.ts`).
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
    active?: boolean;
    allianceId?: string;
    trendDirection?: MetricTrendDirection;
  } = {},
): Promise<SeededMetric> {
  return prisma.metric.create({
    data: {
      allianceId: opts.allianceId ?? ALLIANCE_ID!,
      name: `E2E Alliance Overview Metric ${suffix} ${crypto.randomUUID().slice(0, 8)}`,
      type: opts.type ?? Metric_Type.NUMERIC,
      summaryKind: opts.summaryKind ?? MetricSummaryKind.SUM,
      unitLabel: opts.unitLabel ?? null,
      active: opts.active ?? true,
      trendDirection: opts.trendDirection ?? MetricTrendDirection.NEUTRAL,
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
      name: `E2E Alliance Overview Period ${suffix}`,
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
      playerName: `E2E Alliance Overview Member ${suffix} ${crypto.randomUUID().slice(0, 8)}`,
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

test.describe("Alliance Performance Overview", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ALLIANCE_ID, "TEST_ALLIANCE_ID required");
    test.skip(!process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD, "Owner credentials required");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("the metric universe includes active metrics regardless of attachment, includes an archived metric attached to this period, and excludes an archived metric unrelated to it", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const unrelatedPeriod = await seedPeriod(`${suffix}-unrelated`);

    const activeUnattached = await seedMetric(`${suffix}-unattached`);
    const activeAttached = await seedMetric(`${suffix}-attached`, { unitLabel: "pts" });
    await attachMetric(period.id, activeAttached.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, activeAttached.id, alice.id, 500);

    const archivedAttachedThisPeriod = await seedMetric(`${suffix}-archived-here`, { active: false });
    await attachMetric(period.id, archivedAttachedThisPeriod.id, false);

    const archivedUnrelated = await seedMetric(`${suffix}-archived-unrelated`, { active: false });
    await attachMetric(unrelatedPeriod.id, archivedUnrelated.id);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);

      const unattachedCard = page.getByTestId(`alliance-metric-card-${activeUnattached.id}`);
      await expect(unattachedCard).toBeVisible();
      await expect(unattachedCard).toContainText("Not attached");

      const attachedCard = page.getByTestId(`alliance-metric-card-${activeAttached.id}`);
      await expect(attachedCard.getByTestId("alliance-card-headline")).toContainText("500");

      const archivedHereCard = page.getByTestId(`alliance-metric-card-${archivedAttachedThisPeriod.id}`);
      await expect(archivedHereCard).toContainText("Archived");

      await expect(page.getByTestId(`alliance-metric-card-${archivedUnrelated.id}`)).toHaveCount(0);
    } finally {
      await cleanup({
        metricIds: [activeUnattached.id, activeAttached.id, archivedAttachedThisPeriod.id, archivedUnrelated.id],
        periodIds: [period.id, unrelatedPeriod.id],
        memberIds: [alice.id],
      });
    }
  });

  test("renders honest headlines for SUM, AVERAGE, TRUE_RATE, and NONE metrics in the same period", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);

    const sumMetric = await seedMetric(`${suffix}-sum`, { summaryKind: MetricSummaryKind.SUM, unitLabel: "pts" });
    await attachMetric(period.id, sumMetric.id);
    await recordEntry(period.id, sumMetric.id, alice.id, 300);
    await recordEntry(period.id, sumMetric.id, bob.id, 100);

    const avgMetric = await seedMetric(`${suffix}-avg`, { summaryKind: MetricSummaryKind.AVERAGE });
    await attachMetric(period.id, avgMetric.id);
    await recordEntry(period.id, avgMetric.id, alice.id, 80);
    await recordEntry(period.id, avgMetric.id, bob.id, 40);

    const rateMetric = await seedMetric(`${suffix}-rate`, {
      type: Metric_Type.BOOLEAN,
      summaryKind: MetricSummaryKind.TRUE_RATE,
    });
    await attachMetric(period.id, rateMetric.id);
    await recordEntry(period.id, rateMetric.id, alice.id, 1);
    await recordEntry(period.id, rateMetric.id, bob.id, 0);

    const noneMetric = await seedMetric(`${suffix}-none`, { summaryKind: MetricSummaryKind.NONE });
    await attachMetric(period.id, noneMetric.id);
    await recordEntry(period.id, noneMetric.id, alice.id, 7);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);

      await expect(page.getByTestId(`alliance-metric-card-${sumMetric.id}`).getByTestId("alliance-card-headline")).toContainText("400");
      await expect(page.getByTestId(`alliance-metric-card-${avgMetric.id}`).getByTestId("alliance-card-headline")).toContainText("60");
      await expect(page.getByTestId(`alliance-metric-card-${rateMetric.id}`).getByTestId("alliance-card-headline")).toContainText("50%");
      await expect(page.getByTestId(`alliance-metric-card-${noneMetric.id}`).getByTestId("alliance-card-no-rollup")).toContainText(
        "no alliance-wide rollup",
      );
    } finally {
      await cleanup({
        metricIds: [sumMetric.id, avgMetric.id, rateMetric.id, noneMetric.id],
        periodIds: [period.id],
        memberIds: [alice.id, bob.id],
      });
    }
  });

  test("one shared comparison period applies to every metric, and each metric reports its own honest status against it", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const previous = await seedPeriod(`${suffix}-prev`, {
      startsAt: new Date("2026-04-01T00:00:00.000Z"),
      endsAt: new Date("2026-04-07T23:59:59.999Z"),
    });
    const current = await seedPeriod(`${suffix}-curr`, {
      startsAt: new Date("2026-04-08T00:00:00.000Z"),
      endsAt: new Date("2026-04-14T23:59:59.999Z"),
    });
    const alice = await seedMember(`Alice-${suffix}`);

    const compared = await seedMetric(`${suffix}-compared`, { unitLabel: "pts" });
    await attachMetric(previous.id, compared.id);
    await attachMetric(current.id, compared.id);
    await recordEntry(previous.id, compared.id, alice.id, 50);
    await recordEntry(current.id, compared.id, alice.id, 80);

    const notAttachedInComparison = await seedMetric(`${suffix}-not-attached-in-comparison`);
    await attachMetric(current.id, notAttachedInComparison.id);
    await recordEntry(current.id, notAttachedInComparison.id, alice.id, 10);

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${current.id}&comparePeriodId=${previous.id}`,
      );

      await expect(page.getByTestId("alliance-compare-period-select")).toHaveValue(previous.id);

      const comparedCard = page.getByTestId(`alliance-metric-card-${compared.id}`);
      await expect(comparedCard.getByTestId("alliance-card-comparison")).toContainText("+30");
      await expect(comparedCard.getByTestId("alliance-card-comparison")).toContainText("+60%");

      const notAttachedCard = page.getByTestId(`alliance-metric-card-${notAttachedInComparison.id}`);
      await expect(notAttachedCard.getByTestId("alliance-card-comparison")).toContainText(
        "Not attached in the comparison period",
      );
    } finally {
      await cleanup({
        metricIds: [compared.id, notAttachedInComparison.id],
        periodIds: [previous.id, current.id],
        memberIds: [alice.id],
      });
    }
  });

  test("View Report carries the resolved shared comparison period into the drill-down, instead of letting it silently re-resolve a different one", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    // Three chronologically-ordered periods. The alliance overview's shared
    // comparison selector only checks structural (date) eligibility, so it
    // resolves the nearest one — `middle` — as the comparison for `current`,
    // even though this metric is only ever attached to `oldest` and
    // `current`, never `middle`. The per-metric drill-down's own comparison
    // resolution, by contrast, *does* require real attachment: if the
    // "View Report" link only carried `periodId` (dropping the resolved
    // comparison), the drill-down would silently auto-resolve its *own*
    // nearest eligible period — `oldest` — and show a real comparison
    // against it, contradicting the "Not attached in the comparison period"
    // status this exact card just displayed on the overview.
    const oldest = await seedPeriod(`${suffix}-oldest`, {
      startsAt: new Date("2026-05-01T00:00:00.000Z"),
      endsAt: new Date("2026-05-07T23:59:59.999Z"),
    });
    const middle = await seedPeriod(`${suffix}-middle`, {
      startsAt: new Date("2026-05-08T00:00:00.000Z"),
      endsAt: new Date("2026-05-14T23:59:59.999Z"),
    });
    const current = await seedPeriod(`${suffix}-current`, {
      startsAt: new Date("2026-05-15T00:00:00.000Z"),
      endsAt: new Date("2026-05-21T23:59:59.999Z"),
    });
    const alice = await seedMember(`Alice-${suffix}`);

    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    await attachMetric(oldest.id, metric.id);
    await recordEntry(oldest.id, metric.id, alice.id, 40);
    await attachMetric(current.id, metric.id);
    await recordEntry(current.id, metric.id, alice.id, 90);
    // Deliberately not attached to `middle`.

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${current.id}`);
      await expect(page.getByTestId("alliance-compare-period-select")).toHaveValue(middle.id);

      const card = page.getByTestId(`alliance-metric-card-${metric.id}`);
      await expect(card.getByTestId("alliance-card-comparison")).toContainText("Not attached in the comparison period");

      await card.getByRole("link", { name: "View Report" }).click();

      // The resolved `middle` period id must survive the trip...
      await expect(page).toHaveURL(new RegExp(`comparePeriodId=${middle.id}`));
      // ...and the drill-down must honestly report that `middle` isn't a
      // valid comparison for *this* metric (recommending the real eligible
      // one, `oldest`) rather than silently substituting `oldest` and
      // presenting it as if it were the requested comparison.
      await expect(page.getByTestId("comparison-invalid-banner")).toBeVisible();
      await expect(page.getByTestId("comparison-use-recommended")).toContainText(oldest.name);
      await expect(page.getByTestId("rollup-change")).toHaveCount(0);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [oldest.id, middle.id, current.id], memberIds: [alice.id] });
    }
  });

  test("overall coverage is computed only across active attachments, excluding not-attached metrics from the denominator", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const alice = await seedMember(`Alice-${suffix}`);
    const bob = await seedMember(`Bob-${suffix}`);

    const complete = await seedMetric(`${suffix}-complete`);
    await attachMetric(period.id, complete.id);
    await recordEntry(period.id, complete.id, alice.id, 10);
    await recordEntry(period.id, complete.id, bob.id, 20);

    const notAttached = await seedMetric(`${suffix}-not-attached`);

    // The shared fixture alliance already has its own active members
    // (never assume a clean database) — the coverage denominator is
    // whichever active-member count the alliance has right now (Alice and
    // Bob plus anyone pre-existing), all attributed to the single active
    // attachment (`complete`). The not-attached metric contributes zero
    // expected/recorded cells, so it can't change this number.
    const currentActiveMemberCount = await prisma.allianceMember.count({
      where: { allianceId: ALLIANCE_ID, archivedAt: null },
    });
    const expectedCoveragePercent = formatPercent((2 / currentActiveMemberCount) * 100);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);

      await expect(page.getByTestId("at-a-glance-coverage")).toContainText(expectedCoveragePercent);
    } finally {
      await cleanup({ metricIds: [complete.id, notAttached.id], periodIds: [period.id], memberIds: [alice.id, bob.id] });
    }
  });

  test("the 'Needs attention' findings section flags an adverse comparison only for the metric with an explicit trendDirection (#264 PR2)", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const priorPeriod = await seedPeriod(`${suffix}-prior`, {
      startsAt: new Date("2026-05-01T00:00:00Z"),
      endsAt: new Date("2026-05-07T00:00:00Z"),
    });
    const selectedPeriod = await seedPeriod(`${suffix}-selected`, {
      startsAt: new Date("2026-05-08T00:00:00Z"),
      endsAt: new Date("2026-05-14T00:00:00Z"),
    });
    const alice = await seedMember(`Alice-${suffix}`);

    // Configured HIGHER_IS_BETTER, and its total dropped — expect a finding.
    const donations = await seedMetric(`${suffix}-donations`, { trendDirection: MetricTrendDirection.HIGHER_IS_BETTER });
    await attachMetric(priorPeriod.id, donations.id);
    await attachMetric(selectedPeriod.id, donations.id);
    await recordEntry(priorPeriod.id, donations.id, alice.id, 100, new Date("2026-05-02T00:00:00Z"));
    await recordEntry(selectedPeriod.id, donations.id, alice.id, 40, new Date("2026-05-09T00:00:00Z"));

    // Identical drop, but NEUTRAL (the default) — must never generate a finding.
    const untouched = await seedMetric(`${suffix}-untouched`);
    await attachMetric(priorPeriod.id, untouched.id);
    await attachMetric(selectedPeriod.id, untouched.id);
    await recordEntry(priorPeriod.id, untouched.id, alice.id, 100, new Date("2026-05-02T00:00:00Z"));
    await recordEntry(selectedPeriod.id, untouched.id, alice.id, 40, new Date("2026-05-09T00:00:00Z"));

    try {
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${selectedPeriod.id}&comparePeriodId=${priorPeriod.id}`,
      );

      // Both metrics likely also trigger their own INCOMPLETE_COVERAGE
      // finding (the shared fixture alliance has other active members who
      // never recorded either brand-new metric), so this asserts precisely
      // on ADVERSE_COMPARISON — the one kind that's conditional on an
      // explicit trendDirection — rather than "untouched never appears at
      // all" in the whole findings section.
      const findings = page.getByTestId("alliance-findings-list");
      // The testid is keyed by `${metricId}-${kind}` (unique per finding),
      // so a plain getByTestId won't match — select on the ADVERSE_COMPARISON
      // suffix instead.
      const adverseFindings = findings.locator('[data-testid$="-ADVERSE_COMPARISON"]');
      await expect(adverseFindings).toHaveCount(1);
      await expect(adverseFindings).toContainText(donations.name);

      // The finding links straight to the flagged metric's drill-down.
      await adverseFindings.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/reports/metrics/${donations.id}`));
    } finally {
      await cleanup({
        metricIds: [donations.id, untouched.id],
        periodIds: [priorPeriod.id, selectedPeriod.id],
        memberIds: [alice.id],
      });
    }
  });

  test("the 'Needs attention' section flags an active metric not attached to the selected period, with attach-or-archive guidance (#264 PR2 review)", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    // Deliberately never attached to `period` — "not attached intentionally"
    // and "not attached accidentally" are indistinguishable from stored data
    // alone, so this must surface rather than be silently suppressed.
    const neverAttached = await seedMetric(`${suffix}-never-attached`);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);

      const findings = page.getByTestId("alliance-findings-list");
      const notAttachedFinding = findings.locator(`[data-testid="alliance-finding-${neverAttached.id}-NOT_ATTACHED"]`);
      await expect(notAttachedFinding).toBeVisible();
      await expect(notAttachedFinding).toContainText("isn't attached to this period");
      await expect(notAttachedFinding).toContainText("Attach it to start tracking, or archive it");

      await notAttachedFinding.getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/reports/metrics/${neverAttached.id}`));
    } finally {
      await cleanup({ metricIds: [neverAttached.id], periodIds: [period.id] });
    }
  });

  test("the 'Needs attention' section flags a metric whose explicitly selected comparison period lacks an attachment, with the reason preserved, but never when no comparison is selected (#264 PR2 review)", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const priorPeriod = await seedPeriod(`${suffix}-prior`, {
      startsAt: new Date("2026-06-01T00:00:00Z"),
      endsAt: new Date("2026-06-07T00:00:00Z"),
    });
    const selectedPeriod = await seedPeriod(`${suffix}-selected`, {
      startsAt: new Date("2026-06-08T00:00:00Z"),
      endsAt: new Date("2026-06-14T00:00:00Z"),
    });
    const alice = await seedMember(`Alice-${suffix}`);

    // Attached and has data in the selected period, but was never attached
    // in `priorPeriod` — an explicitly requested comparison against it must
    // still flag the gap, even though the metric's own card already
    // explains why in its comparison summary text.
    const metric = await seedMetric(`${suffix}-cmp-unavailable`);
    await attachMetric(selectedPeriod.id, metric.id);
    await recordEntry(selectedPeriod.id, metric.id, alice.id, 25);

    try {
      // Explicitly select the comparison period the metric was never
      // attached to. (The "no comparison selected at all" case — no
      // COMPARISON_UNAVAILABLE finding — is covered deterministically at
      // the unit level in allianceFindings.test.ts; it isn't reliably
      // constructible here since the alliance-wide selector may still
      // auto-resolve *some* structurally-eligible period as the default.)
      await page.goto(
        `/alliances/${ALLIANCE_ID}/reports?periodId=${selectedPeriod.id}&comparePeriodId=${priorPeriod.id}`,
      );

      const finding = page.getByTestId(`alliance-finding-${metric.id}-COMPARISON_UNAVAILABLE`);
      await expect(finding).toBeVisible();
      await expect(finding).toContainText("wasn't attached in the comparison period");
      await expect(finding).toContainText("no change could be measured");
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [priorPeriod.id, selectedPeriod.id], memberIds: [alice.id] });
    }
  });

  test("the period selector round-trips the selected period via the URL", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const periodA = await seedPeriod(`${suffix}-a`);
    const periodB = await seedPeriod(`${suffix}-b`);
    const metric = await seedMetric(suffix);
    await attachMetric(periodA.id, metric.id);
    await attachMetric(periodB.id, metric.id);

    try {
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${periodA.id}`);
      await expect(page.getByTestId("alliance-report-period-select")).toHaveValue(periodA.id);

      await page.getByTestId("alliance-report-period-select").selectOption(periodB.id);
      await page.waitForURL(new RegExp(`periodId=${periodB.id}`));
      await expect(page.getByTestId("alliance-report-period-select")).toHaveValue(periodB.id);
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [periodA.id, periodB.id] });
    }
  });

  test("a period belonging to another alliance 404s instead of leaking cross-tenant data", async ({ page }) => {
    test.skip(!OTHER_ALLIANCE_ID, "TEST_OTHER_ALLIANCE_ID required");
    const otherPeriod = await seedPeriod("cross-tenant", { allianceId: OTHER_ALLIANCE_ID! });

    try {
      const response = await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${otherPeriod.id}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(/could not be found/i)).toBeVisible();
    } finally {
      await cleanup({ periodIds: [otherPeriod.id] });
    }
  });

  test("@a11y alliance overview page meets accessibility standards", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const period = await seedPeriod(suffix);
    const metric = await seedMetric(suffix, { unitLabel: "pts" });
    await attachMetric(period.id, metric.id);
    const alice = await seedMember(`Alice-${suffix}`);
    await recordEntry(period.id, metric.id, alice.id, 42);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/alliances/${ALLIANCE_ID}/reports?periodId=${period.id}`);
      await expect(page.getByTestId(`alliance-metric-card-${metric.id}`)).toBeVisible();
      await page.waitForLoadState("networkidle");

      await checkA11yWithOptions(page, {
        runOnly: ["wcag2a", "wcag2aa"],
        include: ['[data-testid="alliance-reports-page"]'],
      });
    } finally {
      await cleanup({ metricIds: [metric.id], periodIds: [period.id], memberIds: [alice.id] });
    }
  });
});
