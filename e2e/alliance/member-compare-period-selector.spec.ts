import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { Metric_Type } from "@/app/generated/prisma/enums";

// #349: the explicit "Compare with" selector on member detail - end-to-end
// coverage for canonicalization, picking an explicit comparison, opting
// out, and the two cross-sentinel primary-period transitions
// (MemberPeriodSelector.test.tsx proves these transitions at the
// URL-construction level; this proves a real page render never lands on
// notFound() when a leader clicks through them).
const HERO_NAME = "ComparePeriodE2EHero";
const NAME_PREFIX = "Compare Period E2E";

async function seedMember(allianceId: string) {
  return prisma.allianceMember.create({
    data: { allianceId, playerName: HERO_NAME },
  });
}

async function seedMetric(allianceId: string) {
  return prisma.metric.create({
    data: {
      allianceId,
      name: `${NAME_PREFIX} Kill Points ${Date.now()}`,
      type: Metric_Type.NUMERIC,
      active: true,
    },
  });
}

async function seedPeriodWithEntry(params: {
  allianceId: string;
  memberId: string;
  metricId: string;
  name: string;
  startsAt: Date;
  active: boolean;
  value: number;
}) {
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: params.allianceId,
      name: params.name,
      active: params.active,
      startsAt: params.startsAt,
    },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: period.id, metricId: params.metricId, weight: 10, required: false, active: true },
  });
  await prisma.memberMetricEntry.create({
    data: {
      allianceMemberId: params.memberId,
      periodId: period.id,
      metricId: params.metricId,
      value: params.value,
      recordedAt: params.startsAt,
    },
  });
  return period;
}

test.describe("Member detail - explicit comparison period selector (#349)", () => {
  test.afterEach(async ({ adminScenario }) => {
    if (!adminScenario?.allianceId) return;
    const { allianceId } = adminScenario;
    await prisma.memberMetricEntry.deleteMany({ where: { allianceMember: { allianceId } } });
    await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId } } });
    await prisma.metricPeriod.deleteMany({ where: { allianceId, name: { startsWith: NAME_PREFIX } } });
    await prisma.metric.deleteMany({ where: { allianceId, name: { startsWith: NAME_PREFIX } } });
    await prisma.allianceMember.deleteMany({ where: { allianceId, playerName: HERO_NAME } });
  });

  test("a deep link with only periodId canonicalizes to the immediate predecessor and names it in the trend badge", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const metric = await seedMetric(allianceId);
    const week18 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 18`,
      startsAt: new Date("2026-03-30T00:00:00Z"),
      active: false,
      value: 400_000,
    });
    const week19 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 19`,
      startsAt: new Date("2026-04-06T00:00:00Z"),
      active: true,
      value: 900_000,
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members/${member.id}?periodId=${week19.id}`);

    // Canonicalized: comparePeriodId is now explicit in the URL.
    await expect(page).toHaveURL(new RegExp(`comparePeriodId=${week18.id}`));
    await expect(page.getByLabel("Compare with:")).toHaveValue(week18.id);
    await expect(page.getByText(new RegExp(`vs\\. ${NAME_PREFIX} Week 18`))).toBeVisible();
  });

  test("choosing a non-adjacent comparison period updates the trend baseline and the URL", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const metric = await seedMetric(allianceId);
    const week18 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 18`,
      startsAt: new Date("2026-03-30T00:00:00Z"),
      active: false,
      value: 200_000,
    });
    await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 19`,
      startsAt: new Date("2026-04-06T00:00:00Z"),
      active: false,
      value: 400_000,
    });
    const week20 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 20`,
      startsAt: new Date("2026-04-13T00:00:00Z"),
      active: true,
      value: 900_000,
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(
      `/alliances/${allianceId}/members/${member.id}?periodId=${week20.id}&comparePeriodId=${week18.id}`,
    );

    await expect(page.getByText(new RegExp(`vs\\. ${NAME_PREFIX} Week 18`))).toBeVisible();

    await page.getByLabel("Compare with:").selectOption("none");
    await page.waitForURL(/comparePeriodId=none/);
    await expect(page.getByText(new RegExp(`vs\\. ${NAME_PREFIX} Week 18`))).toHaveCount(0);
    // An active opt-out shows no trend badge at all - not "New".
    await expect(page.getByText("New", { exact: true })).toHaveCount(0);
  });

  test("cross-sentinel transition: 'No comparison' resets to 'no-prior' when the new primary has no older periods, without a 404", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const metric = await seedMetric(allianceId);
    const week18 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 18`,
      startsAt: new Date("2026-03-30T00:00:00Z"),
      active: false,
      value: 400_000,
    });
    const week19 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 19`,
      startsAt: new Date("2026-04-06T00:00:00Z"),
      active: true,
      value: 900_000,
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(
      `/alliances/${allianceId}/members/${member.id}?periodId=${week19.id}&comparePeriodId=none`,
    );
    await expect(page.getByLabel("Compare with:")).toHaveValue("none");

    // Week 18 is the alliance's oldest period - switching the primary to it
    // leaves nothing left to have declined, so the leader must never be
    // dropped onto a rejected/hand-edited-looking URL for an ordinary click.
    await page.getByLabel("Evaluation Period:").selectOption(week18.id);

    await page.waitForURL(new RegExp(`periodId=${week18.id}.*comparePeriodId=no-prior`));
    // A real page render (not Next.js' notFound() boundary) proves the
    // selector never built a URL the resolver would reject.
    await expect(page.getByText("New", { exact: true })).toBeVisible();
  });

  test("cross-sentinel transition: 'no-prior' resolves to the new immediate predecessor once the primary gains older history, without a 404", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const metric = await seedMetric(allianceId);
    const week18 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 18`,
      startsAt: new Date("2026-03-30T00:00:00Z"),
      active: false,
      value: 400_000,
    });
    const week19 = await seedPeriodWithEntry({
      allianceId,
      memberId: member.id,
      metricId: metric.id,
      name: `${NAME_PREFIX} Week 19`,
      startsAt: new Date("2026-04-06T00:00:00Z"),
      active: true,
      value: 900_000,
    });

    await login({ email, password, displayName: "Admin User" });
    // Land on Week 18 (the oldest period) with its truthful "no-prior" state.
    await page.goto(
      `/alliances/${allianceId}/members/${member.id}?periodId=${week18.id}&comparePeriodId=no-prior`,
    );
    await expect(page.getByText("New", { exact: true })).toBeVisible();

    // Switching to Week 19 gains an older period (Week 18) - "no-prior" is
    // no longer legal there, so it must resolve to Week 18, not 404.
    await page.getByLabel("Evaluation Period:").selectOption(week19.id);

    await page.waitForURL(new RegExp(`periodId=${week19.id}.*comparePeriodId=${week18.id}`));
    await expect(page.getByText(new RegExp(`vs\\. ${NAME_PREFIX} Week 18`))).toBeVisible();
  });
});
