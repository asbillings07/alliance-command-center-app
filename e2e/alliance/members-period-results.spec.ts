import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { Metric_Type } from "@/app/generated/prisma/enums";

const HERO_NAME = "MembersE2EHero";

async function seedMember(allianceId: string) {
  return prisma.allianceMember.create({
    data: {
      allianceId,
      playerName: HERO_NAME,
    },
  });
}

async function seedPeriodResults(params: {
  allianceId: string;
  memberId: string;
  periodName: string;
  periodActive: boolean;
  metricName: string;
  metricActive: boolean;
  entryValue: number;
}) {
  const metric = await prisma.metric.create({
    data: {
      allianceId: params.allianceId,
      name: params.metricName,
      type: Metric_Type.NUMERIC,
      active: params.metricActive,
    },
  });
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: params.allianceId,
      name: params.periodName,
      active: params.periodActive,
    },
  });
  await prisma.metricPeriodMetric.create({
    data: {
      periodId: period.id,
      metricId: metric.id,
      weight: 10,
      required: false,
      active: true,
    },
  });
  await prisma.memberMetricEntry.create({
    data: {
      allianceMemberId: params.memberId,
      periodId: period.id,
      metricId: metric.id,
      value: params.entryValue,
      recordedAt: new Date("2026-06-01T00:00:00Z"),
    },
  });
  return { period, metric };
}

async function seedConfiguredButUnrecordedPeriod(params: {
  allianceId: string;
  periodName: string;
  metricName: string;
}) {
  const metric = await prisma.metric.create({
    data: {
      allianceId: params.allianceId,
      name: params.metricName,
      type: Metric_Type.NUMERIC,
      active: true,
    },
  });
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: params.allianceId,
      name: params.periodName,
      active: true,
    },
  });
  await prisma.metricPeriodMetric.create({
    data: {
      periodId: period.id,
      metricId: metric.id,
      weight: 10,
      required: false,
      active: true,
    },
  });
  return { period, metric };
}

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
    await prisma.metric.deleteMany({
      where: { allianceId, name: { startsWith: "Members E2E" } },
    });
    await prisma.allianceMember.deleteMany({
      where: { allianceId, playerName: HERO_NAME },
    });
  });

  test("defaults to roster-only and shows active period results with recorded values", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const { period, metric } = await seedPeriodResults({
      allianceId,
      memberId: member.id,
      periodName: `Members E2E Active ${Date.now()}`,
      periodActive: true,
      metricName: `Members E2E Kill Points ${Date.now()}`,
      metricActive: true,
      entryValue: 1_250_000,
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members`);

    await expect(page.getByText("Viewing:")).toBeVisible();
    await expect(page.getByText("Roster only")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: metric.name })).toHaveCount(0);

    await page.getByLabel("Evaluation period").selectOption(period.id);
    await expect(page).toHaveURL(new RegExp(`periodId=${period.id}`));
    await expect(page.getByRole("columnheader", { name: metric.name })).toBeVisible();
    await expect(page.getByLabel(`${HERO_NAME} ${metric.name}`)).toHaveText("1.3M");

    await page.getByLabel("Evaluation period").selectOption("");
    await expect(page).toHaveURL(`/alliances/${allianceId}/members?filter=active`);
    await expect(page.getByText("Roster only")).toBeVisible();
  });

  test("shows archived period results even when the metric is inactive", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const { period, metric } = await seedPeriodResults({
      allianceId,
      memberId: member.id,
      periodName: `Members E2E Archived ${Date.now()}`,
      periodActive: false,
      metricName: `Members E2E Legacy Points ${Date.now()}`,
      metricActive: false,
      entryValue: 850_000,
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?periodId=${period.id}`);

    await expect(page.getByText("Evaluation results for:")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: metric.name })).toBeVisible();
    await expect(page.getByLabel(`${HERO_NAME} ${metric.name}`)).toHaveText("850K");
    await expect(page.getByLabel("Evaluation period")).toContainText("(Inactive)");
  });

  test("shows invalid period notice for bad deep links", async ({ page, login, adminScenario }) => {
    const { allianceId, email, password } = adminScenario;

    await seedMember(allianceId);
    await prisma.metricPeriod.create({
      data: {
        allianceId,
        name: `Members E2E Existing ${Date.now()}`,
        active: true,
      },
    });
    await login({ email, password, displayName: "Admin User" });
    await page.goto(`/alliances/${allianceId}/members?periodId=missing-period-id`);

    await expect(page.getByText("This evaluation period is not available")).toBeVisible();
    await expect(page.getByText("Create an evaluation period before viewing member results")).toHaveCount(0);
    await page.getByRole("link", { name: "Return to roster" }).click();
    await expect(page).toHaveURL(`/alliances/${allianceId}/members?filter=active`);
  });

  test("shows unrecorded banner on member detail for configured-but-empty period", async ({
    page,
    login,
    adminScenario,
  }) => {
    const { allianceId, email, password } = adminScenario;
    const member = await seedMember(allianceId);
    const { period } = await seedConfiguredButUnrecordedPeriod({
      allianceId,
      periodName: `Members E2E Unrecorded ${Date.now()}`,
      metricName: `Members E2E Pending Points ${Date.now()}`,
    });

    await login({ email, password, displayName: "Admin User" });
    await page.goto(
      `/alliances/${allianceId}/members/${member.id}?periodId=${period.id}`,
    );

    await expect(
      page.getByText(
        "No results were recorded for this member in this evaluation period yet.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Record Results" })).toBeVisible();
    await expect(page.getByText("Not recorded")).toBeVisible();
  });
});
