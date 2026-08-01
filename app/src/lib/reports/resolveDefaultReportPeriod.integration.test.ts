import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { resolveDefaultReportPeriod } from "./resolveDefaultReportPeriod";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("resolveDefaultReportPeriod [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
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
      data: { name: `Default Report Period Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  it("returns null when the metric has never been attached to any period", async () => {
    const alliance = await makeAlliance();
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Unattached", type: "NUMERIC" },
    });

    const result = await resolveDefaultReportPeriod(alliance.id, metric.id);
    expect(result).toBeNull();
  });

  it("prefers the latest active period with an active attachment over an older one", async () => {
    const alliance = await makeAlliance();
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "VS Score", type: "NUMERIC" },
    });
    const older = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Older",
        startsAt: new Date("2026-01-01"),
        endsAt: new Date("2026-01-14"),
      },
    });
    const newer = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Newer",
        startsAt: new Date("2026-03-01"),
        endsAt: new Date("2026-03-14"),
      },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: older.id, metricId: metric.id, weight: 1, required: false, active: true },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: newer.id, metricId: metric.id, weight: 1, required: false, active: true },
    });

    const result = await resolveDefaultReportPeriod(alliance.id, metric.id);
    expect(result).toEqual({ id: newer.id, name: "Newer" });
  });

  it("falls back to a historical attachment when no active+active candidate exists", async () => {
    const alliance = await makeAlliance();
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "VS Score", type: "NUMERIC" },
    });
    const archivedPeriod = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Archived Period",
        active: false,
        startsAt: new Date("2026-01-01"),
        endsAt: new Date("2026-01-14"),
      },
    });
    await prisma.metricPeriodMetric.create({
      data: {
        periodId: archivedPeriod.id,
        metricId: metric.id,
        weight: 1,
        required: false,
        active: true,
      },
    });

    const result = await resolveDefaultReportPeriod(alliance.id, metric.id);
    expect(result).toEqual({ id: archivedPeriod.id, name: "Archived Period" });
  });
});
