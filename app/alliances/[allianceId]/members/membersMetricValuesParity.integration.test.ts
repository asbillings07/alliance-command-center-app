import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The pre-#287-Slice-3 `MembersPage` reduction, reproduced verbatim (it no
 * longer exists in production code) so this test proves parity against the
 * *actual previous behavior*. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
async function oldBuildLatestMetricValueMap(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricIds: string[],
  memberIds: string[],
): Promise<Map<string, number>> {
  const entries =
    metricIds.length > 0 && memberIds.length > 0
      ? await prisma.memberMetricEntry.findMany({
          where: {
            periodId,
            metricId: { in: metricIds },
            allianceMemberId: { in: memberIds },
            allianceMember: { allianceId },
          },
          select: { allianceMemberId: true, metricId: true, value: true, recordedAt: true, createdAt: true, id: true },
          orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        })
      : [];

  const map = new Map<string, number>();
  for (const entry of entries) {
    if (entry.value === null) continue;
    const key = `${entry.allianceMemberId}:${entry.metricId}`;
    if (!map.has(key)) {
      map.set(key, entry.value);
    }
  }
  return map;
}

/** The new implementation, exactly as `MembersPage` now calls it. */
async function newBuildLatestMetricValueMap(
  allianceId: string,
  periodId: string,
  metricIds: string[],
  memberIds: string[],
): Promise<Map<string, number>> {
  const rows =
    metricIds.length > 0 && memberIds.length > 0
      ? await memberPeriodMetricValues(allianceId, periodId, metricIds, { onlyParticipating: true, memberIds })
      : [];

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.value === null) continue;
    map.set(`${row.allianceMemberId}:${row.metricId}`, row.value);
  }
  return map;
}

// #287 Slice 3 diff log: MembersPage's latestMetricValueByMemberAndMetric
// reduction, old (raw "keep the newest non-null row" scan) vs new
// (memberPeriodMetricValues).
describe.skipIf(!runDb)("MembersPage metric value map parity [integration]", () => {
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

  async function makeSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Members Page Parity Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    return { alliance, period, metric };
  }

  it("PASS: two corrections collapse to the latest value", async () => {
    const { alliance, period, metric } = await makeSetup();
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Corrected" } });

    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 900000, recordedAt: new Date("2026-07-23T10:00:00Z") },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 1250000, recordedAt: new Date("2026-07-24T10:00:00Z") },
    });

    const [oldMap, newMap] = await Promise.all([
      oldBuildLatestMetricValueMap(prisma, alliance.id, period.id, [metric.id], [member.id]),
      newBuildLatestMetricValueMap(alliance.id, period.id, [metric.id], [member.id]),
    ]);

    expect(newMap).toEqual(oldMap);
    expect(newMap.get(`${member.id}:${metric.id}`)).toBe(1250000);
  });

  it("PASS: a member with no entry is absent from the map, and the map is bounded to only the given memberIds", async () => {
    const { alliance, period, metric } = await makeSetup();
    const withEntry = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Has Entry" } });
    const noEntry = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "No Entry" } });
    const excludedFromPage = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Excluded Page" } });

    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: withEntry.id, periodId: period.id, metricId: metric.id, value: 500 },
    });
    // Has a real entry too, but this page's current filter/pagination
    // doesn't include this member on the current view - memberIds must
    // exclude it from both the query and the result, not just the display.
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: excludedFromPage.id, periodId: period.id, metricId: metric.id, value: 999 },
    });

    const pageMemberIds = [withEntry.id, noEntry.id];
    const [oldMap, newMap] = await Promise.all([
      oldBuildLatestMetricValueMap(prisma, alliance.id, period.id, [metric.id], pageMemberIds),
      newBuildLatestMetricValueMap(alliance.id, period.id, [metric.id], pageMemberIds),
    ]);

    expect(newMap).toEqual(oldMap);
    expect(newMap.get(`${withEntry.id}:${metric.id}`)).toBe(500);
    expect(newMap.has(`${noEntry.id}:${metric.id}`)).toBe(false);
    expect(newMap.has(`${excludedFromPage.id}:${metric.id}`)).toBe(false);
  });

  it("EXPECTED_BREAKING: when a member's most recent event for a metric is a VOIDED correction of a previously ACTIVE value, the old scan incorrectly falls back to the stale active value; the new map correctly omits the pair", async () => {
    const { alliance, period, metric } = await makeSetup();
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Corrected Then Voided" } });

    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: 750000,
        status: "ACTIVE",
        recordedAt: new Date("2026-07-23T10:00:00Z"),
      },
    });
    // The most recent event for this (member, metric) pair is a void - no
    // write path can create one yet (the void mutation is a later #287
    // slice), so this scenario is inert in production today.
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: null,
        status: "VOIDED",
        recordedAt: new Date("2026-07-24T10:00:00Z"),
      },
    });

    const [oldMap, newMap] = await Promise.all([
      oldBuildLatestMetricValueMap(prisma, alliance.id, period.id, [metric.id], [member.id]),
      newBuildLatestMetricValueMap(alliance.id, period.id, [metric.id], [member.id]),
    ]);

    // Old: the scan's `continue` on the null-valued VOIDED row never marks
    // the key as "seen," so it falls through to the earlier ACTIVE row and
    // shows a stale value that's no longer current.
    expect(oldMap.get(`${member.id}:${metric.id}`)).toBe(750000);
    // New: memberPeriodMetricValues' `slot_winner` correctly picks the
    // VOIDED row as the winner (latest by recordedAt, regardless of
    // status), so this member has zero active winning slots and is
    // excluded by `onlyParticipating`.
    expect(newMap.has(`${member.id}:${metric.id}`)).toBe(false);
  });
});
