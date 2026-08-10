import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getSetupFunnel, getStalledAlliances } from "./setup";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * #287: getSetupFunnel's "Evaluation Results Imported" stage and
 * getStalledAlliances' "no data" branch, against real Postgres. Unlike
 * allianceSetup.ts's target-period-scoped check, these ask a coarser
 * "has this alliance EVER had real evaluation data, in any period"
 * question (no memberPeriodMetricValues migration - these are
 * platform-ops completeness signals, not member-history reads), so the
 * fix here is narrowing the Prisma relation filter to `status: "ACTIVE"`,
 * not swapping in the canonical read model. See
 * docs/database-design/287-slice3-consumer-parity-log.md.
 */
describe.skipIf(!runDb)("platform/setup.ts 'has data' signals [integration]", () => {
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

  async function makeSetup(createdAt?: Date) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Setup Funnel Alliance ${suffix}`, server: "1001", ...(createdAt ? { createdAt } : {}) },
    });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1", active: true, startsAt: new Date("2026-07-01T00:00:00Z") },
    });
    const metric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Leader" } });
    return { alliance, period, metric, member };
  }

  it("counts an alliance with a real ACTIVE entry toward 'Evaluation Results Imported'", async () => {
    const { alliance, period, metric, member } = await makeSetup();
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    const before = await getSetupFunnel();
    const stage = before.stages.find((s) => s.label === "Evaluation Results Imported");
    expect(stage?.count).toBeGreaterThanOrEqual(1);

    // Isolate this alliance's own contribution rather than asserting a
    // brittle exact global count.
    const stalled = await getStalledAlliances();
    expect(stalled.some((a) => a.id === alliance.id)).toBe(false);
  });

  it("EXPECTED_BREAKING vs. the pre-fix 'any row' predicate: an alliance whose only entry is VOIDED does not count as 'Evaluation Results Imported' and still shows up as stalled", async () => {
    const { alliance, period, metric, member } = await makeSetup(new Date("2020-01-01T00:00:00Z"));
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED" },
    });

    const stalled = await getStalledAlliances();
    // Old predicate (removed): allianceMembers.some(metricEntries.some({}))
    // would have matched this VOIDED row and excluded this alliance from
    // "stalled." The fixed predicate correctly still flags it.
    expect(stalled.some((a) => a.id === alliance.id)).toBe(true);
  });

  it("does not count an alliance with zero entries toward 'Evaluation Results Imported' and flags it as stalled", async () => {
    const { alliance } = await makeSetup(new Date("2020-01-01T00:00:00Z"));

    const stalled = await getStalledAlliances();
    expect(stalled.some((a) => a.id === alliance.id)).toBe(true);
  });
});
