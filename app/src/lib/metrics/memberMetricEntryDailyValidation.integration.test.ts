import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4c: a DAILY_OBSERVATION insert requires both period
// boundaries to be set and observedOn to fall within them.
describe.skipIf(!runDb)("MemberMetricEntry daily-observation insert validation [integration]", () => {
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

  async function makeSetup(periodOverrides: { startsAt?: Date | null; endsAt?: Date | null } = {}) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Daily Validation Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Week 1",
        startsAt: "startsAt" in periodOverrides ? periodOverrides.startsAt : new Date("2026-01-01T00:00:00.000Z"),
        endsAt: "endsAt" in periodOverrides ? periodOverrides.endsAt : new Date("2026-01-07T23:59:59.999Z"),
      },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily VS",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  it("accepts a daily entry whose observedOn falls within the period boundaries", async () => {
    const { member, period, metric } = await makeSetup();

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

  it("rejects a daily entry whose observedOn is before the period start", async () => {
    const { member, period, metric } = await makeSetup();

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2025-12-31T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow(/outside period .* boundaries/i);
  });

  it("rejects a daily entry whose observedOn is after the period end", async () => {
    const { member, period, metric } = await makeSetup();

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-08T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow(/outside period .* boundaries/i);
  });

  it("rejects a daily entry when the period has no start date set", async () => {
    const { member, period, metric } = await makeSetup({ startsAt: null });

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
    ).rejects.toThrow(/must have both start and end dates set/i);
  });

  it("rejects a daily entry when the period has no end date set", async () => {
    const { member, period, metric } = await makeSetup({ endsAt: null });

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
    ).rejects.toThrow(/must have both start and end dates set/i);
  });

  it("does not apply range validation to a PERIOD_VALUE entry even with no boundaries set", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Daily Validation No-op Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });
    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "No Boundaries" },
    });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Weekly VS", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

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
    ).resolves.not.toThrow();
  });
});
