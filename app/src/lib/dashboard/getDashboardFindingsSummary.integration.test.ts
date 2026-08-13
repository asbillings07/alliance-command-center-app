import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { getDashboardFindingsSummary } from "./getDashboardFindingsSummary";
import { AlliancePerformanceReportNotFoundError } from "@/app/src/lib/reports/getAlliancePerformanceReport";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("getDashboardFindingsSummary [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Findings Summary Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function makeMember(allianceId: string, playerName: string) {
    return prisma.allianceMember.create({ data: { allianceId, playerName } });
  }

  async function makePeriod(allianceId: string, name: string) {
    return prisma.metricPeriod.create({ data: { allianceId, name } });
  }

  async function makeMetric(allianceId: string, name: string, summaryKind: MetricSummaryKind) {
    return prisma.metric.create({ data: { allianceId, name, type: Metric_Type.NUMERIC, summaryKind } });
  }

  async function attach(periodId: string, metricId: string) {
    return prisma.metricPeriodMetric.create({ data: { periodId, metricId, weight: 1, required: false } });
  }

  it("propagates AlliancePerformanceReportNotFoundError for a period belonging to another alliance", async () => {
    const alliance = await makeAlliance();
    const other = await makeAlliance();
    const otherPeriod = await makePeriod(other.id, "Other Week");

    await expect(
      getDashboardFindingsSummary({ allianceId: alliance.id, periodId: otherPeriod.id }),
    ).rejects.toThrow(AlliancePerformanceReportNotFoundError);
  });

  it("counts a metric with no recorded results as one actionable finding", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Donations", MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    const summary = await getDashboardFindingsSummary({ allianceId: alliance.id, periodId: period.id });

    expect(summary).toEqual({ actionableFindingCount: 1 }); // MISSING_RESULTS
  });

  it("counts a fully-attached, fully-recorded metric as zero actionable findings", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const member = await makeMember(alliance.id, "Full Coverage");
    const metric = await makeMetric(alliance.id, "Donations", MetricSummaryKind.SUM);
    await attach(period.id, metric.id);
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    const summary = await getDashboardFindingsSummary({ allianceId: alliance.id, periodId: period.id });

    expect(summary).toEqual({ actionableFindingCount: 0 });
  });

  it("never reflects another alliance's metrics or coverage gaps", async () => {
    const allianceA = await makeAlliance();
    const allianceB = await makeAlliance();
    const periodA = await makePeriod(allianceA.id, "Week 1");
    const periodB = await makePeriod(allianceB.id, "Week 1");

    // Alliance B has an unresolved coverage gap; Alliance A has none.
    const metricA = await makeMetric(allianceA.id, "Donations", MetricSummaryKind.SUM);
    const memberA = await makeMember(allianceA.id, "A Member");
    await attach(periodA.id, metricA.id);
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberA.id, periodId: periodA.id, metricId: metricA.id, value: 100 },
    });

    const metricB = await makeMetric(allianceB.id, "Donations", MetricSummaryKind.SUM);
    await attach(periodB.id, metricB.id);

    const summaryA = await getDashboardFindingsSummary({ allianceId: allianceA.id, periodId: periodA.id });
    const summaryB = await getDashboardFindingsSummary({ allianceId: allianceB.id, periodId: periodB.id });

    expect(summaryA).toEqual({ actionableFindingCount: 0 });
    expect(summaryB).toEqual({ actionableFindingCount: 1 });
  });

  it("throws when allianceId or periodId is missing", async () => {
    await expect(getDashboardFindingsSummary({ allianceId: "", periodId: "p1" })).rejects.toThrow(
      /allianceId and periodId are required/,
    );
    await expect(getDashboardFindingsSummary({ allianceId: "a1", periodId: "" })).rejects.toThrow(
      /allianceId and periodId are required/,
    );
  });
});
