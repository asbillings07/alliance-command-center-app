import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getBetaStats } from "./betaDashboard";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * #287: getBetaStats' readiness/needsAttention (ACTIVE-only fix) against
 * real Postgres, alongside getRecentActivity (intentionally left
 * untouched - it's a recent-activity feed, which surfaces historical
 * context including VOIDED rows, same reasoning as
 * members/[memberId]/page.tsx). See
 * docs/database-design/287-slice3-consumer-parity-log.md.
 */
describe.skipIf(!runDb)("getBetaStats readiness/needsAttention vs. recentActivity [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("./prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeSetup(createdAt: Date) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Beta Dashboard Alliance ${suffix}`, server: "1001", createdAt },
    });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1", active: true, startsAt: createdAt },
    });
    const metric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Leader" } });
    return { alliance, period, metric, member };
  }

  it("EXPECTED_BREAKING vs. the pre-fix count: an alliance whose only entry is VOIDED is not 'ready' and shows up in needsAttention as stuck", async () => {
    const { alliance, period, metric, member } = await makeSetup(new Date("2020-01-01T00:00:00Z"));
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED" },
    });

    const stats = await getBetaStats();

    // Old behavior (removed): _count.metricEntries and the "some: {}"
    // predicate both counted this VOIDED row, so this alliance would
    // have been "ready" and excluded from needsAttention's stuck list.
    expect(stats.needsAttention.some((item) => item.id === alliance.id && item.type === "stuck_alliance")).toBe(true);
  });

  it("counts an alliance with a real ACTIVE entry as ready and not stuck", async () => {
    const { alliance, period, metric, member } = await makeSetup(new Date("2020-01-01T00:00:00Z"));
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    const stats = await getBetaStats();

    expect(stats.needsAttention.some((item) => item.id === alliance.id)).toBe(false);
  });

  it("still surfaces a VOIDED entry in recentActivity (unfiltered by design)", async () => {
    const { alliance, period, metric, member } = await makeSetup(new Date("2020-01-01T00:00:00Z"));
    // Far-future so this row deterministically sorts to the top of the
    // global "most recent 5 entries" feed regardless of what other
    // integration tests are concurrently inserting.
    const recordedAt = new Date("2099-01-01T00:00:00Z");
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED", recordedAt },
    });

    const stats = await getBetaStats();

    expect(
      stats.recentActivity.some(
        (item) => item.allianceName === alliance.name && item.description === "Recorded metrics",
      ),
    ).toBe(true);
  });
});
