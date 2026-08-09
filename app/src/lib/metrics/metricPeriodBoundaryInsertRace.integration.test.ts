import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { heldTransaction, expectStillBlocked } from "./testing/heldTransaction";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4c: SELECT ... FOR SHARE on MetricPeriod serializes
// a daily-observation INSERT against a concurrent boundary UPDATE, so
// neither can validate against the other's stale, uncommitted state. This
// is the two-session regression the design's §7 lists explicitly.
describe.skipIf(!runDb)(
  "daily-observation insert vs. period boundary edit race [integration]",
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
        data: { name: `Boundary Insert Race Alliance ${suffix}`, server: "1001" },
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

    it("blocks a concurrent boundary edit while a daily insert's transaction is open, then rejects the edit once the insert has committed", async () => {
      const { member, period, metric } = await makeSetup();

      const insertTxn = heldTransaction(prisma, (tx) =>
        tx.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: period.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date("2026-01-03T00:00:00.000Z"),
            value: 10,
            status: "ACTIVE",
          },
        }),
      );
      // The insert has executed (and holds FOR SHARE on the period row) but
      // has not committed yet.
      await insertTxn.ready;

      const boundaryEdit = prisma.metricPeriod.update({
        where: { id: period.id },
        data: { endsAt: new Date("2026-01-10T23:59:59.999Z") },
      });

      // Without the FOR SHARE fix, this UPDATE could run immediately against
      // the not-yet-committed period and see zero daily entries.
      await expectStillBlocked(boundaryEdit);

      insertTxn.commit();
      await insertTxn.committed;

      // Now that the daily entry is committed, trigger 4b's EXISTS check
      // sees it and rejects the boundary edit.
      await expect(boundaryEdit).rejects.toThrow(/boundaries are immutable/i);
    });

    it("blocks a concurrent daily insert while a boundary edit's transaction is open, then re-validates against the edit's committed (not stale) boundaries", async () => {
      const { member, period, metric } = await makeSetup();

      // Narrows the period so day 3 - the date the concurrent insert below
      // targets - falls outside the new range.
      const boundaryTxn = heldTransaction(prisma, (tx) =>
        tx.metricPeriod.update({
          where: { id: period.id },
          data: {
            startsAt: new Date("2026-01-05T00:00:00.000Z"),
            endsAt: new Date("2026-01-07T23:59:59.999Z"),
          },
        }),
      );
      await boundaryTxn.ready;

      const dailyInsert = prisma.memberMetricEntry.create({
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

      // Without the FOR SHARE fix, this INSERT could validate against the
      // original (pre-edit) startsAt/endsAt still visible in its own
      // snapshot, incorrectly succeeding.
      await expectStillBlocked(dailyInsert);

      boundaryTxn.commit();
      await boundaryTxn.committed;

      // The insert now re-validates against the *committed* Jan 5-7 range,
      // and Jan 3 falls outside it - proving it read fresh, not stale, data.
      await expect(dailyInsert).rejects.toThrow(/outside period .* boundaries/i);
    });
  },
);
