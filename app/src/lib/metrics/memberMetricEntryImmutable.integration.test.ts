import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4d: MemberMetricEntry rows are fully immutable after
// insert - every legitimate change is a new row (a correction or a void),
// never an in-place edit, per ADR-018 §2's append-only model.
describe.skipIf(!runDb)("MemberMetricEntry full immutability after insert [integration]", () => {
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

  async function makeEntry() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Entry Immutability Alliance ${suffix}`, server: "1001" },
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
        name: "Daily VS",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    const entry = await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-04T00:00:00.000Z"),
        value: 10,
        status: "ACTIVE",
      },
    });

    return { alliance, member, period, metric, entry };
  }

  it("rejects updating value", async () => {
    const { entry } = await makeEntry();

    await expect(
      prisma.memberMetricEntry.update({ where: { id: entry.id }, data: { value: 99 } }),
    ).rejects.toThrow(/immutable after insert/i);
  });

  it("rejects an update that would move observedOn/periodId into a combination never validated against any period's boundaries", async () => {
    const { entry } = await makeEntry();

    await expect(
      prisma.memberMetricEntry.update({
        where: { id: entry.id },
        data: { observedOn: new Date("2099-01-01T00:00:00.000Z") },
      }),
    ).rejects.toThrow(/immutable after insert/i);
  });

  it("rejects voiding by in-place update - a void must be a new row", async () => {
    const { entry } = await makeEntry();

    await expect(
      prisma.memberMetricEntry.update({
        where: { id: entry.id },
        data: { status: "VOIDED", value: null },
      }),
    ).rejects.toThrow(/immutable after insert/i);
  });
});
