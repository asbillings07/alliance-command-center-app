import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The pre-#287-Slice-3 `queryMatrixCells` implementation, reproduced
 * verbatim (it no longer exists in production code) so this test proves
 * parity against the *actual previous behavior*. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
async function oldQueryMatrixCells(
  prisma: PrismaClient,
  periodId: string,
  metricIds: string[],
  memberIds: string[],
): Promise<Array<{ metricId: string; memberId: string; value: number | null }>> {
  if (metricIds.length === 0 || memberIds.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<{ metric_id: string; member_id: string; value: number | null }>>`
    SELECT DISTINCT ON ("metricId", "allianceMemberId")
      "metricId" AS metric_id, "allianceMemberId" AS member_id, value
    FROM "MemberMetricEntry"
    WHERE "periodId" = ${periodId}
      AND "metricId" IN (${Prisma.join(metricIds)})
      AND "allianceMemberId" IN (${Prisma.join(memberIds)})
    ORDER BY "metricId", "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
  `;
  return rows.map((row) => ({ metricId: row.metric_id, memberId: row.member_id, value: row.value }));
}

/**
 * The new implementation's shape, reproduced here (not imported - it's a
 * private helper inside `getAllianceMemberMetricMatrix.ts`) via the exact
 * same call the real function now makes.
 */
async function newQueryMatrixCells(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricIds: string[],
  memberIds: string[],
): Promise<Array<{ metricId: string; memberId: string; value: number | null }>> {
  const { memberPeriodMetricValues } = await import("@/app/src/lib/metrics/memberPeriodMetricValues");
  if (metricIds.length === 0 || memberIds.length === 0) return [];
  const memberIdSet = new Set(memberIds);
  const values = await memberPeriodMetricValues(allianceId, periodId, metricIds, { onlyParticipating: true });
  return values
    .filter((row) => memberIdSet.has(row.allianceMemberId))
    .map((row) => ({ metricId: row.metricId, memberId: row.allianceMemberId, value: row.value }));
}

function sortCells(cells: Array<{ metricId: string; memberId: string; value: number | null }>) {
  return [...cells].sort((a, b) => (a.metricId + a.memberId).localeCompare(b.metricId + b.memberId));
}

// #287 Slice 3 diff log: getAllianceMemberMetricMatrix.ts's queryMatrixCells,
// old (raw DISTINCT ON) vs new (memberPeriodMetricValues).
describe.skipIf(!runDb)("getAllianceMemberMetricMatrix queryMatrixCells parity [integration]", () => {
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

  it("PASS: single entry, corrections, missing rows, and a voided-only entry all match the old implementation exactly", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Matrix Cells Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    const memberA = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Single Entry" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberA.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

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
          metricId: metric.id,
          value,
          recordedAt: new Date(recordedAt),
        },
      });
    }

    const memberC = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "No Entry" },
    });

    // A voided-only entry: `buildCell`'s own `?? null` fallback already
    // treats "no row" and "row with a null value" identically (both
    // MISSING), so - unlike getPeriodResultsSummary's participation count -
    // this specific consumer's visible output doesn't actually diverge for
    // this scenario, even though the new query excludes the pair entirely
    // while the old query would have returned it with `value: null`.
    const memberD = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Voided Only" },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: memberD.id,
        periodId: period.id,
        metricId: metric.id,
        value: null,
        status: "VOIDED",
      },
    });

    const memberIds = [memberA.id, memberB.id, memberC.id, memberD.id];

    const [oldCells, newCells] = await Promise.all([
      oldQueryMatrixCells(prisma, period.id, [metric.id], memberIds),
      newQueryMatrixCells(prisma, alliance.id, period.id, [metric.id], memberIds),
    ]);

    // Old includes an explicit null-value row for the voided-only member;
    // new omits it entirely - both resolve to the same MISSING cell, so
    // compare post-buildCell-equivalent state (presence-or-null) rather
    // than raw row shape.
    const oldValueByMember = new Map(oldCells.map((c) => [c.memberId, c.value]));
    const newValueByMember = new Map(newCells.map((c) => [c.memberId, c.value]));

    for (const memberId of memberIds) {
      expect(newValueByMember.get(memberId) ?? null).toBe(oldValueByMember.get(memberId) ?? null);
    }

    expect(newValueByMember.get(memberA.id)).toBe(100);
    expect(newValueByMember.get(memberB.id)).toBe(30);
    expect(newValueByMember.get(memberC.id) ?? null).toBeNull();
    expect(newValueByMember.get(memberD.id) ?? null).toBeNull();
  });

  it("EXPECTED_BREAKING: a DAILY_OBSERVATION + SUM metric column shows only its latest single day's raw value under the old query, but the true rolled-up sum under the new one (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Matrix Cells Daily Parity Alliance ${suffix}`, server: "1001" },
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
    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily Donations",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    for (const day of [6, 7, 8]) {
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date(`2026-01-0${day}T00:00:00.000Z`),
          value: 10,
          status: "ACTIVE",
        },
      });
    }

    const [oldCells, newCells] = await Promise.all([
      oldQueryMatrixCells(prisma, period.id, [metric.id], [member.id]),
      newQueryMatrixCells(prisma, alliance.id, period.id, [metric.id], [member.id]),
    ]);

    // Old: only the latest day's raw value (10). New: the true SUM (30).
    expect(oldCells[0]?.value).toBe(10);
    expect(newCells[0]?.value).toBe(30);
  });

  it("orders and shapes results identically to a hand-sorted comparison for a multi-metric, multi-member fixture", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Matrix Cells Multi Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metricA = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kills", type: "NUMERIC" },
    });
    const metricB = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Donations", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metricA.id, weight: 1, required: false },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metricB.id, weight: 1, required: false },
    });
    const memberA = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Player A" },
    });
    const memberB = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Player B" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberA.id, periodId: period.id, metricId: metricA.id, value: 1 },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberA.id, periodId: period.id, metricId: metricB.id, value: 2 },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberB.id, periodId: period.id, metricId: metricA.id, value: 3 },
    });

    const memberIds = [memberA.id, memberB.id];
    const metricIds = [metricA.id, metricB.id];

    const [oldCells, newCells] = await Promise.all([
      oldQueryMatrixCells(prisma, period.id, metricIds, memberIds),
      newQueryMatrixCells(prisma, alliance.id, period.id, metricIds, memberIds),
    ]);

    expect(sortCells(newCells)).toEqual(sortCells(oldCells));
    expect(newCells).toHaveLength(3); // no row for memberB/metricB - matches old
  });
});
