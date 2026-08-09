import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §1: proves the actual deploy-safety claim for Phase 1
// ("Expand") - an INSERT that omits observationGrain/memberPeriodRollup
// entirely (simulating an old, pre-#287 application instance still warm
// during the cutover window between `prisma migrate deploy` completing and
// this deploy's code fully taking over traffic) still succeeds via the
// temporary default, rather than failing with a NOT NULL violation.
//
// The other half of §1's claim - that this same omission starts failing once
// the separate, later Phase 3 migration drops these defaults - is Phase 3's
// own verification, not this one's: that migration does not exist yet (by
// design, per §1's expand/bake/contract sequencing), so it cannot be
// exercised here.
describe.skipIf(!runDb)("Phase 1 deployment-window compatibility defaults [integration]", () => {
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

  it("a Metric INSERT that omits observationGrain/memberPeriodRollup entirely still succeeds via the temporary default", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Deployment Window Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    // Deliberately mirrors old code: no observationGrain/memberPeriodRollup
    // in the payload at all, exactly what every writer looked like before
    // this PR.
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Old Code Metric", type: "NUMERIC" },
    });

    expect(metric.observationGrain).toBe("PERIOD_VALUE");
    expect(metric.memberPeriodRollup).toBe("LATEST");
  });

  it("a MemberMetricEntry INSERT that omits observationGrain (and status) entirely still succeeds via the temporary/permanent defaults", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Deployment Window Entry Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });
    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1" },
    });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Old Code Metric", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    // Deliberately mirrors old code: no observationGrain/status in the
    // payload, exactly what record/action.ts, import/action.ts, and
    // multiPeriodAction.ts looked like before this PR.
    const entry = await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: 10,
      },
    });

    expect(entry.observationGrain).toBe("PERIOD_VALUE");
    expect(entry.status).toBe("ACTIVE");
  });
});
