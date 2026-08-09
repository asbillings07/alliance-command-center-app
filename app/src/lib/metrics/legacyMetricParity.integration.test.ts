import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { memberPeriodMetricValues } from "./memberPeriodMetricValues";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The old, pre-#287 "latest wins" query every consumer independently
 * implements today (see e.g. `getMetricSummaryReport.ts`'s
 * `queryVisualizationRows`) - reproduced verbatim here, not imported, so
 * this test proves parity against the *pattern* every consumer shares
 * rather than against one arbitrarily-chosen consumer's unrelated
 * pagination/filtering logic.
 */
async function oldLatestWinsQuery(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricId: string,
): Promise<Array<{ allianceMemberId: string; value: number | null }>> {
  const rows = await prisma.$queryRaw<Array<{ alliance_member_id: string; value: number | null }>>`
    WITH latest AS (
      SELECT DISTINCT ON ("allianceMemberId") "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" = ${metricId}
      ORDER BY "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    )
    SELECT am.id AS alliance_member_id, l.value AS value
    FROM "AllianceMember" am
    LEFT JOIN latest l ON l.member_id = am.id
    WHERE am."allianceId" = ${allianceId}
    ORDER BY am.id ASC
  `;
  return rows.map((row) => ({ allianceMemberId: row.alliance_member_id, value: row.value }));
}

// ADR-018's "no behavior change" claim for the legacy PERIOD_VALUE + LATEST
// backfill, proved directly: for a representative dataset, the canonical
// read model's output is identical to the old per-consumer query's output.
describe.skipIf(!runDb)("memberPeriodMetricValues legacy parity [integration]", () => {
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

  it("matches the old latest-wins query exactly across a representative legacy PERIOD_VALUE+LATEST dataset (single entry, multiple corrections, and no entry at all)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Legacy Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1" },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "VS Score",
        type: "NUMERIC",
        observationGrain: "PERIOD_VALUE",
        memberPeriodRollup: "LATEST",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    // Member A: a single entry - the trivial case.
    const memberA = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Single Entry" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: memberA.id, periodId: period.id, metricId: metric.id, value: 500 },
    });

    // Member B: three corrections over time - "latest wins" must pick the
    // last one by (recordedAt, createdAt, id), not insertion order alone.
    const memberB = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Corrected Entry" },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: memberB.id,
        periodId: period.id,
        metricId: metric.id,
        value: 100,
        recordedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: memberB.id,
        periodId: period.id,
        metricId: metric.id,
        value: 300,
        recordedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: memberB.id,
        periodId: period.id,
        metricId: metric.id,
        value: 200,
        recordedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });

    // Member C: no entry at all - must appear with a NULL value, never
    // absent from the result set.
    const memberC = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "No Entry" },
    });

    const [oldResults, newResults] = await Promise.all([
      oldLatestWinsQuery(prisma, alliance.id, period.id, metric.id),
      memberPeriodMetricValues(alliance.id, period.id, [metric.id]),
    ]);

    const newByMemberId = new Map(newResults.map((row) => [row.allianceMemberId, row]));

    expect(oldResults).toHaveLength(3);
    for (const oldRow of oldResults) {
      const newRow = newByMemberId.get(oldRow.allianceMemberId);
      expect(newRow?.value).toBe(oldRow.value);
    }

    // Spelled out per member too, so a failure names which case broke.
    expect(newByMemberId.get(memberA.id)?.value).toBe(500);
    expect(newByMemberId.get(memberB.id)?.value).toBe(300);
    expect(newByMemberId.get(memberC.id)?.value).toBeNull();

    // A PERIOD_VALUE metric has exactly one slot per member (observedOn is
    // always NULL), so observationCount is 1 whenever any entry exists,
    // never inflated by the two extra corrections on member B.
    expect(newByMemberId.get(memberA.id)?.observationCount).toBe(1);
    expect(newByMemberId.get(memberB.id)?.observationCount).toBe(1);
    expect(newByMemberId.get(memberC.id)?.observationCount).toBe(0);

    for (const row of newResults) {
      expect(row.provenance).toBe("Source period value");
    }
  });

  it("handles multiple requested metrics in one call identically to running the old query once per metric", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Legacy Parity Multi-Metric Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1" },
    });

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

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metricA.id, value: 10 },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metricB.id, value: 20 },
    });

    const [oldA, oldB, combined] = await Promise.all([
      oldLatestWinsQuery(prisma, alliance.id, period.id, metricA.id),
      oldLatestWinsQuery(prisma, alliance.id, period.id, metricB.id),
      memberPeriodMetricValues(alliance.id, period.id, [metricA.id, metricB.id]),
    ]);

    expect(combined).toHaveLength(2);
    const combinedByMetric = new Map(combined.map((row) => [row.metricId, row]));
    expect(combinedByMetric.get(metricA.id)?.value).toBe(oldA[0]?.value);
    expect(combinedByMetric.get(metricB.id)?.value).toBe(oldB[0]?.value);
    expect(combinedByMetric.get(metricA.id)?.value).toBe(10);
    expect(combinedByMetric.get(metricB.id)?.value).toBe(20);
  });
});
