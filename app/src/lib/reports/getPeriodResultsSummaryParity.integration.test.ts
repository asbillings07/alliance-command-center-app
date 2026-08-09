import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getPeriodResultsSummary, type PeriodResultsSummary } from "./getPeriodResultsSummary";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The pre-#287-Slice-3 implementation, reproduced verbatim (not imported -
 * it no longer exists in production code) so this test proves parity
 * against the *actual previous behavior*, not a hand-waved description of
 * it. See `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
async function oldGetPeriodResultsSummary(
  prisma: PrismaClient,
  params: { allianceId: string; periodId: string },
): Promise<PeriodResultsSummary> {
  const { allianceId, periodId } = params;

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
    select: {
      id: true,
      periodMetrics: {
        where: { active: true },
        select: { metric: { select: { id: true, name: true } } },
        orderBy: { metric: { name: "asc" } },
      },
    },
  });
  if (!period) throw new Error("Period not found");

  const currentActiveMemberCount = await prisma.allianceMember.count({
    where: { allianceId, archivedAt: null },
  });

  const activeMetricIds = period.periodMetrics.map((pm) => pm.metric.id);
  if (activeMetricIds.length === 0) {
    return { participatingMemberCount: 0, currentActiveMemberCount, participatingActiveMemberCount: 0, metrics: [] };
  }

  const distinctMemberMetricPairs = await prisma.memberMetricEntry.groupBy({
    by: ["allianceMemberId", "metricId"],
    where: { periodId, metricId: { in: activeMetricIds }, allianceMember: { allianceId } },
  });

  const participatingMemberIdsList = Array.from(new Set(distinctMemberMetricPairs.map((p) => p.allianceMemberId)));
  const activeMembers =
    participatingMemberIdsList.length > 0
      ? await prisma.allianceMember.findMany({
          where: { id: { in: participatingMemberIdsList }, allianceId, archivedAt: null },
          select: { id: true },
        })
      : [];
  const activeMemberIdSet = new Set(activeMembers.map((m) => m.id));

  const participatingMemberIds = new Set<string>();
  const participatingActiveMemberIds = new Set<string>();
  const entriesByMetric = new Map<string, { memberIds: Set<string>; activeMemberIds: Set<string> }>();

  for (const pair of distinctMemberMetricPairs) {
    participatingMemberIds.add(pair.allianceMemberId);
    const isMemberActive = activeMemberIdSet.has(pair.allianceMemberId);
    if (isMemberActive) participatingActiveMemberIds.add(pair.allianceMemberId);

    let buckets = entriesByMetric.get(pair.metricId);
    if (!buckets) {
      buckets = { memberIds: new Set(), activeMemberIds: new Set() };
      entriesByMetric.set(pair.metricId, buckets);
    }
    buckets.memberIds.add(pair.allianceMemberId);
    if (isMemberActive) buckets.activeMemberIds.add(pair.allianceMemberId);
  }

  const metrics = period.periodMetrics.map((pm) => {
    const buckets = entriesByMetric.get(pm.metric.id);
    return {
      metricId: pm.metric.id,
      metricName: pm.metric.name,
      memberCount: buckets ? buckets.memberIds.size : 0,
      activeMemberCount: buckets ? buckets.activeMemberIds.size : 0,
    };
  });

  return {
    participatingMemberCount: participatingMemberIds.size,
    currentActiveMemberCount,
    participatingActiveMemberCount: participatingActiveMemberIds.size,
    metrics,
  };
}

// #287 Slice 3 diff log (docs/database-design/287-slice3-consumer-parity-log.md):
// getPeriodResultsSummary.ts old (raw groupBy) vs new (memberPeriodMetricValues).
describe.skipIf(!runDb)("getPeriodResultsSummary parity [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
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

  it("PASS: single entry, corrections, missing rows, and multiple daily dates all match the old implementation exactly", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Period Summary Parity Alliance ${suffix}`, server: "1001" },
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

    const metricA = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" },
    });
    const metricB = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily Donations",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metricA.id, weight: 1, required: false },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metricB.id, weight: 1, required: false },
    });

    // Scenario: single entry.
    const memberA = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Single Entry" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberA.id, periodId: period.id, metricId: metricA.id, value: 100 },
    });

    // Scenario: corrections (3 entries for the same member+metric).
    const memberB = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Corrected Entry" },
    });
    for (const [value, recordedAt] of [
      [10, "2026-01-01T00:00:00.000Z"],
      [30, "2026-01-03T00:00:00.000Z"],
      [20, "2026-01-02T00:00:00.000Z"],
    ] as const) {
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: memberB.id,
          periodId: period.id,
          metricId: metricA.id,
          value,
          recordedAt: new Date(recordedAt),
        },
      });
    }

    // Scenario: missing rows entirely - created but deliberately never given
    // an entry, so it must not appear as participating in either result.
    await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "No Entry" },
    });

    // Scenario: multiple daily observations for one DAILY_OBSERVATION metric.
    const memberD = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Multi-Date" },
    });
    for (const day of [6, 7, 8]) {
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: memberD.id,
          periodId: period.id,
          metricId: metricB.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date(`2026-01-0${day}T00:00:00.000Z`),
          value: 5,
          status: "ACTIVE",
        },
      });
    }

    const [oldResult, newResult] = await Promise.all([
      oldGetPeriodResultsSummary(prisma, { allianceId: alliance.id, periodId: period.id }),
      getPeriodResultsSummary({ allianceId: alliance.id, periodId: period.id }),
    ]);

    expect(newResult).toEqual(oldResult);
    expect(newResult.participatingMemberCount).toBe(3); // memberA, memberB, memberD (not memberC)
    // Ordered by metric name ascending ("Daily Donations" < "Kill Points"),
    // matching `period.periodMetrics`'s own orderBy.
    expect(newResult.metrics).toEqual([
      { metricId: metricB.id, metricName: "Daily Donations", memberCount: 1, activeMemberCount: 1 },
      { metricId: metricA.id, metricName: "Kill Points", memberCount: 2, activeMemberCount: 2 },
    ]);
  });

  it("EXPECTED_BREAKING: a voided-only entry counts as participating under the old groupBy but not under the new active-slot semantics (ADR-018 fix, no production behavior change today since no writer produces VOIDED rows yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Period Summary Voided Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Voided Only" },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: null,
        status: "VOIDED",
      },
    });

    const [oldResult, newResult] = await Promise.all([
      oldGetPeriodResultsSummary(prisma, { allianceId: alliance.id, periodId: period.id }),
      getPeriodResultsSummary({ allianceId: alliance.id, periodId: period.id }),
    ]);

    // The documented divergence: old counts a voided-only member as
    // participating (a bug); new correctly excludes them.
    expect(oldResult.participatingMemberCount).toBe(1);
    expect(newResult.participatingMemberCount).toBe(0);
    expect(newResult.metrics).toEqual([
      { metricId: metric.id, metricName: "Kill Points", memberCount: 0, activeMemberCount: 0 },
    ]);
  });
});
