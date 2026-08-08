import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §3d: the composite (metricId, observationGrain)
// foreign key is the actual guarantee that an entry's grain snapshot can
// never drift from its metric's real, immutable observationGrain - a CHECK
// alone cannot join to Metric to enforce this.
describe.skipIf(!runDb)("MemberMetricEntry grain-snapshot foreign key [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeSetup(metricGrain: "PERIOD_VALUE" | "DAILY_OBSERVATION") {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Grain FK Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Week 1",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-01-07T23:59:59.999Z"),
      },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Metric",
        type: "NUMERIC",
        observationGrain: metricGrain,
        memberPeriodRollup: metricGrain === "DAILY_OBSERVATION" ? "SUM" : "LATEST",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  it("rejects an entry claiming DAILY_OBSERVATION for a metric that is actually PERIOD_VALUE", async () => {
    const { member, period, metric } = await makeSetup("PERIOD_VALUE");

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-04T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("rejects an entry claiming PERIOD_VALUE for a metric that is actually DAILY_OBSERVATION", async () => {
    const { member, period, metric } = await makeSetup("DAILY_OBSERVATION");

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "PERIOD_VALUE",
          value: 10,
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("accepts an entry whose grain matches its metric's actual grain", async () => {
    const { member, period, metric } = await makeSetup("DAILY_OBSERVATION");

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-04T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      }),
    ).resolves.not.toThrow();
  });

  it("blocks deleting a Metric that still has grain-matched entries (ON DELETE RESTRICT)", async () => {
    const { member, period, metric } = await makeSetup("PERIOD_VALUE");

    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "PERIOD_VALUE",
        value: 10,
        status: "ACTIVE",
      },
    });

    await expect(prisma.metric.delete({ where: { id: metric.id } })).rejects.toThrow(
      /foreign key constraint/i,
    );
  });
});
