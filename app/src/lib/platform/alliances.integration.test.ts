import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getAllianceReadiness, getAllianceTimeline } from "./alliances";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * #287: getAllianceReadiness's `hasData`/`isComplete` (ACTIVE-only fix)
 * against real Postgres, alongside getAllianceTimeline's `firstDataset`/
 * `lastActivity` (intentionally left untouched - they surface historical
 * context, including VOIDED rows, same reasoning as
 * members/[memberId]/page.tsx). See
 * docs/database-design/287-slice3-consumer-parity-log.md.
 */
describe.skipIf(!runDb)("platform/alliances.ts readiness vs. timeline [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as { prisma: PrismaClient });
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

  async function makeSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Older than the "new" (< 7 days) window so readiness resolves to
    // ready/needsSetup/stalled rather than always "new".
    const alliance = await prisma.alliance.create({
      data: { name: `Readiness Alliance ${suffix}`, server: "1001", createdAt: new Date("2020-01-01T00:00:00Z") },
    });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1", active: true, startsAt: new Date("2020-01-01T00:00:00Z") },
    });
    const metric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Leader" } });
    return { alliance, period, metric, member };
  }

  it("marks readiness hasData true and status ready with a real ACTIVE entry", async () => {
    const { alliance, period, metric, member } = await makeSetup();
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    const items = await getAllianceReadiness();
    const item = items.find((a) => a.id === alliance.id);

    expect(item?.hasData).toBe(true);
    expect(item?.status).toBe("ready");
  });

  it("EXPECTED_BREAKING vs. the pre-fix count: readiness hasData stays false when the only entry is VOIDED, and the alliance is stalled", async () => {
    const { alliance, period, metric, member } = await makeSetup();
    // recordedAt is old (not "now") so lastActivity - which intentionally
    // still includes this VOIDED row - is old enough to trip the
    // "stalled" (no recent activity) branch too, not just hasData.
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: null,
        status: "VOIDED",
        recordedAt: new Date("2020-01-02T00:00:00Z"),
      },
    });

    const items = await getAllianceReadiness();
    const item = items.find((a) => a.id === alliance.id);

    // Old behavior (removed): _count.metricEntries counted this VOIDED
    // row, so hasData/isComplete/status "ready" would all have been true.
    expect(item?.hasData).toBe(false);
    expect(item?.status).toBe("stalled");
  });

  it("still surfaces a VOIDED entry's timestamp as readiness's lastActivity (unfiltered by design)", async () => {
    const { alliance, period, metric, member } = await makeSetup();
    const recordedAt = new Date("2026-06-15T10:00:00Z");
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED", recordedAt },
    });

    const items = await getAllianceReadiness();
    const item = items.find((a) => a.id === alliance.id);

    expect(item?.lastActivity?.toISOString()).toBe(recordedAt.toISOString());
  });

  it("still surfaces a VOIDED entry as the timeline's firstDataset/lastActivity events (unfiltered by design)", async () => {
    const { alliance, period, metric, member } = await makeSetup();
    const recordedAt = new Date("2026-06-15T10:00:00Z");
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED", recordedAt },
    });

    const timeline = await getAllianceTimeline(alliance.id);
    const firstDataset = timeline?.events.find((e) => e.event === "Imported Evaluation Results");
    const lastActivity = timeline?.events.find((e) => e.event === "Last Activity");

    expect(firstDataset?.completed).toBe(true);
    expect(firstDataset?.timestamp?.toISOString()).toBe(recordedAt.toISOString());
    expect(lastActivity?.timestamp?.toISOString()).toBe(recordedAt.toISOString());
  });
});
