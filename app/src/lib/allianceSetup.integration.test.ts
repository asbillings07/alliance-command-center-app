import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getAllianceSetupStatus } from "./allianceSetup";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * #287 Slice 3: getAllianceSetupStatus's "data" task, against real
 * Postgres, exercising the exact scenario that motivated migrating it to
 * memberPeriodMetricValues (ADR-018 §6) - see
 * docs/database-design/287-slice3-consumer-parity-log.md.
 */
describe.skipIf(!runDb)("getAllianceSetupStatus 'data' task [integration]", () => {
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

  async function makeSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Setup Alliance ${suffix}`, server: "1001" } });
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

  it("marks 'data' complete once a real active entry exists for the target period", async () => {
    const { alliance, period, metric, member } = await makeSetup();

    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    const status = await getAllianceSetupStatus(alliance.id);

    expect(status.tasks.find((t) => t.id === "data")?.completed).toBe(true);
  });

  it("keeps 'data' incomplete when the target period has zero entries", async () => {
    const { alliance } = await makeSetup();

    const status = await getAllianceSetupStatus(alliance.id);

    expect(status.tasks.find((t) => t.id === "data")?.completed).toBe(false);
  });

  // The bug fix: a period whose only entry has since been voided must not
  // read as "has data." No write path can create a VOIDED row yet (the
  // void mutation is a later #287 slice), so this is inert in production
  // today - it becomes correct-by-construction once that ships.
  it("EXPECTED_BREAKING vs. the pre-fix count: keeps 'data' incomplete when the target period's only entry is VOIDED", async () => {
    const { alliance, period, metric, member } = await makeSetup();

    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED" },
    });

    const status = await getAllianceSetupStatus(alliance.id);

    // Old behavior (removed): prisma.memberMetricEntry.count({...}) > 0
    // would have counted this VOIDED row and incorrectly marked "data"
    // complete.
    expect(status.tasks.find((t) => t.id === "data")?.completed).toBe(false);
  });

  it("EXPECTED_BREAKING vs. the pre-fix count: an ACTIVE entry later voided for the same slot ends up incomplete again, not stuck complete", async () => {
    const { alliance, period, metric, member } = await makeSetup();

    // The old count-based check would have counted BOTH rows (2 > 0) and
    // never revisited "data" once any row existed. The fixed check
    // correctly re-derives the slot's current winner every time: the
    // later VOIDED row beats the earlier ACTIVE one for the same
    // (metric, member, observedOn) slot (ADR-018 §1's slot_winner phase),
    // so the alliance genuinely has zero active winning slots again.
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 50, recordedAt: new Date("2026-07-01T10:00:00Z") },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED", recordedAt: new Date("2026-07-02T10:00:00Z") },
    });

    const status = await getAllianceSetupStatus(alliance.id);

    expect(status.tasks.find((t) => t.id === "data")?.completed).toBe(false);
  });
});
