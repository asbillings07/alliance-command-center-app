import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { heldTransaction, expectStillBlocked } from "./testing/heldTransaction";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4c/§7: a multi-period import transaction can hold
// FOR SHARE on several MetricPeriod rows at once (multiPeriodAction.ts loops
// over groupPlans, inserting each group's entries before moving to the
// next). FOR SHARE never conflicts with FOR SHARE regardless of acquisition
// order, so two such transactions locking the same two periods in opposite
// orders must both commit without deadlocking - and a boundary edit on
// either period must still block while either transaction is open, exactly
// like the single-period case.
describe.skipIf(!runDb)(
  "multi-period daily insert lock ordering vs. boundary edits [integration]",
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
        data: { name: `Multi-Period Lock Order Alliance ${suffix}`, server: "1001" },
      });
      createdAllianceIds.push(alliance.id);

      const member = await prisma.allianceMember.create({
        data: { allianceId: alliance.id, playerName: "Test Player" },
      });

      const periodP1 = await prisma.metricPeriod.create({
        data: {
          allianceId: alliance.id,
          name: "P1",
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: new Date("2026-01-07T23:59:59.999Z"),
        },
      });
      const periodP2 = await prisma.metricPeriod.create({
        data: {
          allianceId: alliance.id,
          name: "P2",
          startsAt: new Date("2026-01-08T00:00:00.000Z"),
          endsAt: new Date("2026-01-14T23:59:59.999Z"),
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
        data: { periodId: periodP1.id, metricId: metric.id, weight: 1, required: false },
      });
      await prisma.metricPeriodMetric.create({
        data: { periodId: periodP2.id, metricId: metric.id, weight: 1, required: false },
      });

      return { alliance, member, periodP1, periodP2, metric };
    }

    it("commits both transactions when they lock the same two periods in opposite orders", async () => {
      const { member, periodP1, periodP2, metric } = await makeSetup();

      // Session 1: P1 then P2, with a deliberate pause between the two
      // inserts to widen the window during which both sessions are actively
      // trying to acquire their second lock.
      const session1 = prisma.$transaction(async (tx) => {
        await tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: periodP1.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-02T00:00:00.000Z"),
            value: 1,
            status: "ACTIVE",
          },
        });
        await tx.$queryRawUnsafe("SELECT pg_sleep(0.3)::text");
        await tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: periodP2.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-09T00:00:00.000Z"),
            value: 2,
            status: "ACTIVE",
          },
        });
      });

      // Session 2: the reverse order, P2 then P1.
      const session2 = prisma.$transaction(async (tx) => {
        await tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: periodP2.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-10T00:00:00.000Z"),
            value: 3,
            status: "ACTIVE",
          },
        });
        await tx.$queryRawUnsafe("SELECT pg_sleep(0.3)::text");
        await tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: periodP1.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-03T00:00:00.000Z"),
            value: 4,
            status: "ACTIVE",
          },
        });
      });

      await expect(Promise.all([session1, session2])).resolves.toBeDefined();

      const total = await prisma.memberMetricEntry.count({
        where: { periodId: { in: [periodP1.id, periodP2.id] } },
      });
      expect(total).toBe(4);
    });

    it("blocks a boundary edit on either locked period while a multi-period transaction is still open, matching the single-period case", async () => {
      const { member, periodP1, periodP2, metric } = await makeSetup();

      const multiPeriodTxn = heldTransaction(prisma, async (tx) => {
        await tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: periodP1.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-02T00:00:00.000Z"),
            value: 1,
            status: "ACTIVE",
          },
        });
        await tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: periodP2.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-09T00:00:00.000Z"),
            value: 2,
            status: "ACTIVE",
          },
        });
      });
      await multiPeriodTxn.ready;

      const boundaryEditOnP2 = prisma.metricPeriod.update({
        where: { id: periodP2.id },
        data: { endsAt: new Date("2026-01-20T23:59:59.999Z") },
      });

      await expectStillBlocked(boundaryEditOnP2);

      multiPeriodTxn.commit();
      await multiPeriodTxn.committed;

      // P2 now has a committed daily entry, so trigger 4b rejects the edit.
      await expect(boundaryEditOnP2).rejects.toThrow(/boundaries are immutable/i);
    });
  },
);
