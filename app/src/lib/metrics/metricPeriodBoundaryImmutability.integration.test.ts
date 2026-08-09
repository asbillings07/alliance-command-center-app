import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4b: MetricPeriod boundary immutability once a daily
// observation exists - checked directly against MemberMetricEntry existence,
// not a stored flag.
describe.skipIf(!runDb)(
  "MetricPeriod boundary immutability after a daily observation exists [integration]",
  () => {
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
        data: { name: `Boundary Immutability Alliance ${suffix}`, server: "1001" },
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

      return { alliance, member, period, metric };
    }

    it("allows boundary edits before any daily observation exists", async () => {
      const { period } = await makeSetup();

      await expect(
        prisma.metricPeriod.update({
          where: { id: period.id },
          data: { endsAt: new Date("2026-01-10T23:59:59.999Z") },
        }),
      ).resolves.not.toThrow();
    });

    it("rejects a boundary edit once a daily observation has been recorded", async () => {
      const { member, period, metric } = await makeSetup();

      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-03T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      });

      await expect(
        prisma.metricPeriod.update({
          where: { id: period.id },
          data: { endsAt: new Date("2026-01-10T23:59:59.999Z") },
        }),
      ).rejects.toThrow(/boundaries are immutable/i);
    });

    it("still allows an edit that does not touch startsAt/endsAt even after a daily observation exists", async () => {
      const { member, period, metric } = await makeSetup();

      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-03T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      });

      await expect(
        prisma.metricPeriod.update({
          where: { id: period.id },
          data: { name: "Week 1 (renamed)" },
        }),
      ).resolves.not.toThrow();
    });

    it("keeps boundaries immutable even once that daily observation is voided - a tombstone still proves historical use", async () => {
      const { member, period, metric } = await makeSetup();

      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-03T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      });
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-03T00:00:00.000Z"),
          value: null,
          status: "VOIDED",
        },
      });

      await expect(
        prisma.metricPeriod.update({
          where: { id: period.id },
          data: { endsAt: new Date("2026-01-10T23:59:59.999Z") },
        }),
      ).rejects.toThrow(/boundaries are immutable/i);
    });
  },
);
