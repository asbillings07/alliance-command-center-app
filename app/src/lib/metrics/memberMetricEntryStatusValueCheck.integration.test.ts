import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §3b: ADR-018 §2's tombstone state machine, enforced
// at the database boundary - an ACTIVE row always carries a value, a VOIDED
// row never does.
describe.skipIf(!runDb)("MemberMetricEntry status/value CHECK constraint [integration]", () => {
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

  async function makeSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Status Value Check Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1" },
    });

    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Score", type: "NUMERIC" },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  it("rejects ACTIVE with a null value", async () => {
    const { member, period, metric } = await makeSetup();

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          status: "ACTIVE",
          value: null,
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it("rejects VOIDED with a non-null value", async () => {
    const { member, period, metric } = await makeSetup();

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          status: "VOIDED",
          value: 5,
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it("accepts ACTIVE with a non-null value", async () => {
    const { member, period, metric } = await makeSetup();

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          status: "ACTIVE",
          value: 5,
        },
      }),
    ).resolves.not.toThrow();
  });

  it("accepts VOIDED with a null value", async () => {
    const { member, period, metric } = await makeSetup();

    await expect(
      prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          status: "VOIDED",
          value: null,
        },
      }),
    ).resolves.not.toThrow();
  });
});
