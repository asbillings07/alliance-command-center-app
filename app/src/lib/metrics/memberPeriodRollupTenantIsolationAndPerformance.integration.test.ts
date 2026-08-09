import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { memberPeriodMetricValues } from "./memberPeriodMetricValues";

const runDb = process.env.INTEGRATION_DB === "true";

// ADR-002: "Never assume a single alliance." Proves the canonical read
// model's two independent tenant scopes (`requested_metrics` and the
// member roster cross join) both hold, and that it stays fast at a
// representative row volume (#287 database design §6/§7).
describe.skipIf(!runDb)(
  "memberPeriodMetricValues tenant isolation and performance [integration]",
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

    async function createAllianceWithMetric(namePrefix: string) {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const alliance = await prisma.alliance.create({
        data: { name: `${namePrefix} ${suffix}`, server: "1001" },
      });
      createdAllianceIds.push(alliance.id);

      const period = await prisma.metricPeriod.create({
        data: { allianceId: alliance.id, name: "Week 1" },
      });

      const metric = await prisma.metric.create({
        data: { allianceId: alliance.id, name: "Kills", type: "NUMERIC" },
      });

      await prisma.metricPeriodMetric.create({
        data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
      });

      const member = await prisma.allianceMember.create({
        data: { allianceId: alliance.id, playerName: "Test Player" },
      });
      await prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 777 },
      });

      return { alliance, period, metric, member };
    }

    it("never returns another alliance's rows, even querying with that alliance's own period/metric/member ids by name-shape coincidence", async () => {
      const a = await createAllianceWithMetric("Tenant Isolation Alliance A");
      const b = await createAllianceWithMetric("Tenant Isolation Alliance B");

      const resultsForA = await memberPeriodMetricValues(a.alliance.id, a.period.id, [a.metric.id]);

      expect(resultsForA).toHaveLength(1);
      expect(resultsForA[0]?.allianceMemberId).toBe(a.member.id);
      expect(resultsForA[0]?.allianceMemberId).not.toBe(b.member.id);
      expect(resultsForA[0]?.value).toBe(777);
    });

    it("silently drops a foreign-tenant metricId rather than smuggling its rows into the result set", async () => {
      const a = await createAllianceWithMetric("Tenant Isolation Alliance A");
      const b = await createAllianceWithMetric("Tenant Isolation Alliance B");

      // Query alliance A's period, but ask for alliance B's metric id -
      // that metric doesn't belong to A, so `requested_metrics` excludes
      // it and the result set is empty, never B's data under A's period.
      const results = await memberPeriodMetricValues(a.alliance.id, a.period.id, [b.metric.id]);

      expect(results).toHaveLength(0);
    });

    it("returns the correct, non-degraded result for a representative multi-member, multi-metric, multi-day dataset within a reasonable time budget", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const alliance = await prisma.alliance.create({
        data: { name: `Performance Alliance ${suffix}`, server: "1001" },
      });
      createdAllianceIds.push(alliance.id);

      const period = await prisma.metricPeriod.create({
        data: {
          allianceId: alliance.id,
          name: "Week 1",
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: new Date("2026-01-14T23:59:59.999Z"),
        },
      });

      const metrics = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          prisma.metric.create({
            data: {
              allianceId: alliance.id,
              name: `Daily Metric ${i}`,
              type: "NUMERIC",
              observationGrain: "DAILY_OBSERVATION",
              memberPeriodRollup: "SUM",
            },
          }),
        ),
      );
      await Promise.all(
        metrics.map((metric) =>
          prisma.metricPeriodMetric.create({
            data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
          }),
        ),
      );

      const members = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          prisma.allianceMember.create({
            data: { allianceId: alliance.id, playerName: `Player ${i}` },
          }),
        ),
      );

      // 50 members x 3 metrics x 7 daily observations = 1,050 rows.
      const entries: Array<{
        allianceMemberId: string;
        periodId: string;
        metricId: string;
        observationGrain: "DAILY_OBSERVATION";
        observedOn: Date;
        value: number;
        status: "ACTIVE";
      }> = [];
      for (const member of members) {
        for (const metric of metrics) {
          for (let day = 6; day <= 12; day += 1) {
            entries.push({
              allianceMemberId: member.id,
              periodId: period.id,
              metricId: metric.id,
              observationGrain: "DAILY_OBSERVATION",
              observedOn: new Date(`2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`),
              value: 10,
              status: "ACTIVE",
            });
          }
        }
      }
      await prisma.memberMetricEntry.createMany({ data: entries });

      const start = performance.now();
      const results = await memberPeriodMetricValues(
        alliance.id,
        period.id,
        metrics.map((m) => m.id),
      );
      const elapsedMs = performance.now() - start;

      // 50 members x 3 metrics = 150 (member, metric) pairs, every one
      // present regardless of activity.
      expect(results).toHaveLength(150);
      for (const row of results) {
        expect(row.value).toBe(70); // 7 days x value 10
        expect(row.observationCount).toBe(7);
      }

      // A generous regression guard, not a strict benchmark - catches an
      // accidentally-quadratic query (e.g. a per-member N+1) without being
      // flaky on a loaded CI runner.
      expect(elapsedMs).toBeLessThan(3000);
    });
  },
);
