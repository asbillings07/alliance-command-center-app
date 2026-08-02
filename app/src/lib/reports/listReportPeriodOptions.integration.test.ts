import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { listReportPeriodOptions } from "./listReportPeriodOptions";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("listReportPeriodOptions [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Report Period Options Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function makeMetric(allianceId: string) {
    return prisma.metric.create({
      data: {
        allianceId,
        name: "VS Score",
        type: Metric_Type.NUMERIC,
        summaryKind: MetricSummaryKind.SUM,
      },
    });
  }

  async function makePeriod(
    allianceId: string,
    name: string,
    opts: { active?: boolean; startsAt?: Date } = {},
  ) {
    return prisma.metricPeriod.create({
      data: { allianceId, name, active: opts.active ?? true, startsAt: opts.startsAt },
    });
  }

  it("excludes periods the metric was never attached to", async () => {
    const alliance = await makeAlliance();
    const metric = await makeMetric(alliance.id);
    const attached = await makePeriod(alliance.id, "Attached Week", { startsAt: new Date("2026-01-01") });
    await makePeriod(alliance.id, "Never Attached Week", { startsAt: new Date("2026-01-08") });
    await prisma.metricPeriodMetric.create({
      data: { periodId: attached.id, metricId: metric.id, active: true, weight: 1, required: false },
    });

    const options = await listReportPeriodOptions(alliance.id, metric.id);

    expect(options.map((o) => o.id)).toEqual([attached.id]);
  });

  it("includes both active and inactive attachments, with their attachment/period status flags", async () => {
    const alliance = await makeAlliance();
    const metric = await makeMetric(alliance.id);
    const activeAttachmentPeriod = await makePeriod(alliance.id, "Active Attachment Week", {
      startsAt: new Date("2026-02-01"),
    });
    const inactiveAttachmentPeriod = await makePeriod(alliance.id, "Inactive Attachment Week", {
      startsAt: new Date("2026-01-01"),
    });
    const archivedPeriod = await makePeriod(alliance.id, "Archived Week", {
      active: false,
      startsAt: new Date("2025-12-01"),
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: activeAttachmentPeriod.id, metricId: metric.id, active: true, weight: 1, required: false },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: inactiveAttachmentPeriod.id, metricId: metric.id, active: false, weight: 1, required: false },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: archivedPeriod.id, metricId: metric.id, active: true, weight: 1, required: false },
    });

    const options = await listReportPeriodOptions(alliance.id, metric.id);

    // Newest startsAt first.
    expect(options.map((o) => o.id)).toEqual([
      activeAttachmentPeriod.id,
      inactiveAttachmentPeriod.id,
      archivedPeriod.id,
    ]);
    expect(options.find((o) => o.id === activeAttachmentPeriod.id)).toMatchObject({
      periodActive: true,
      attachmentActive: true,
    });
    expect(options.find((o) => o.id === inactiveAttachmentPeriod.id)).toMatchObject({
      periodActive: true,
      attachmentActive: false,
    });
    expect(options.find((o) => o.id === archivedPeriod.id)).toMatchObject({
      periodActive: false,
      attachmentActive: true,
    });
  });

  it("never leaks another alliance's periods", async () => {
    const alliance = await makeAlliance();
    const otherAlliance = await makeAlliance();
    const metric = await makeMetric(alliance.id);
    const otherMetric = await makeMetric(otherAlliance.id);
    const otherPeriod = await makePeriod(otherAlliance.id, "Other Alliance Week");
    await prisma.metricPeriodMetric.create({
      data: { periodId: otherPeriod.id, metricId: otherMetric.id, active: true, weight: 1, required: false },
    });

    const options = await listReportPeriodOptions(alliance.id, metric.id);

    expect(options).toEqual([]);
  });
});
