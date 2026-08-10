import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { computeAggregateSnapshot, type AggregateSnapshot } from "./metricRollup";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";

const runDb = process.env.INTEGRATION_DB === "true";

type BulkAggregateRawRow = {
  metric_id: string;
  sum_value: bigint;
  avg_value: number | null;
  true_count: bigint;
  false_count: bigint;
  invalid_count: bigint;
  has_negative_values: boolean;
  current_active_member_count: bigint;
  recorded_active_member_count: bigint;
  invalid_active_member_count: bigint;
  missing_active_member_count: bigint;
  archived_contributing_member_count: bigint;
  latest_entry_count: bigint;
};

function mapAggregateRow(row: BulkAggregateRawRow): AggregateSnapshot {
  return {
    sumValue: Number(row.sum_value),
    averageValue: row.avg_value,
    trueCount: Number(row.true_count),
    falseCount: Number(row.false_count),
    invalidCount: Number(row.invalid_count),
    hasNegativeValues: row.has_negative_values,
    currentActiveMemberCount: Number(row.current_active_member_count),
    recordedActiveMemberCount: Number(row.recorded_active_member_count),
    invalidActiveMemberCount: Number(row.invalid_active_member_count),
    missingActiveMemberCount: Number(row.missing_active_member_count),
    archivedContributingMemberCount: Number(row.archived_contributing_member_count),
    latestEntryCount: Number(row.latest_entry_count),
  };
}

/**
 * The pre-#287-Slice-3 `queryBulkAggregates`, reproduced verbatim (it no
 * longer exists in production code) so this test proves parity against
 * the *actual previous behavior*. Unlike `getMetricSummaryReport.ts`'s
 * single-metric `queryAggregate`, this cross-joins every requested metric
 * against every alliance member in one query (`metric_types` x
 * `AllianceMember`), grouped by `metric_id` - the multi-metric shape this
 * test exists to exercise. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
async function oldQueryBulkAggregates(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricIds: string[],
): Promise<Map<string, AggregateSnapshot>> {
  if (metricIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<BulkAggregateRawRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("metricId", "allianceMemberId")
        "metricId" AS metric_id, "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" IN (${Prisma.join(metricIds)})
      ORDER BY "metricId", "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    ),
    metric_types AS (
      SELECT id AS metric_id, (type = 'BOOLEAN'::"Metric_Type") AS is_boolean
      FROM "Metric"
      WHERE id IN (${Prisma.join(metricIds)})
    ),
    cells AS (
      SELECT
        mt.metric_id,
        mt.is_boolean,
        am.id AS member_id,
        (am."archivedAt" IS NULL) AS is_active,
        l.value
      FROM metric_types mt
      CROSS JOIN "AllianceMember" am
      LEFT JOIN latest l ON l.metric_id = mt.metric_id AND l.member_id = am.id
      WHERE am."allianceId" = ${allianceId}
    )
    SELECT
      metric_id,
      COALESCE(SUM(value) FILTER (
        WHERE value IS NOT NULL AND (NOT is_boolean OR value IN (0, 1))
      ), 0)::bigint AS sum_value,
      AVG(value) FILTER (
        WHERE value IS NOT NULL AND (NOT is_boolean OR value IN (0, 1))
      )::float8 AS avg_value,
      COUNT(*) FILTER (WHERE is_boolean AND value = 1)::bigint AS true_count,
      COUNT(*) FILTER (WHERE is_boolean AND value = 0)::bigint AS false_count,
      COUNT(*) FILTER (
        WHERE is_boolean AND value IS NOT NULL AND value NOT IN (0, 1)
      )::bigint AS invalid_count,
      COALESCE(BOOL_OR(value IS NOT NULL AND value < 0), FALSE) AS has_negative_values,
      COUNT(*) FILTER (WHERE is_active)::bigint AS current_active_member_count,
      COUNT(*) FILTER (
        WHERE is_active AND value IS NOT NULL AND (NOT is_boolean OR value IN (0, 1))
      )::bigint AS recorded_active_member_count,
      COUNT(*) FILTER (
        WHERE is_active AND is_boolean AND value IS NOT NULL AND value NOT IN (0, 1)
      )::bigint AS invalid_active_member_count,
      COUNT(*) FILTER (WHERE is_active AND value IS NULL)::bigint AS missing_active_member_count,
      COUNT(*) FILTER (
        WHERE NOT is_active AND value IS NOT NULL
      )::bigint AS archived_contributing_member_count,
      COUNT(*) FILTER (WHERE value IS NOT NULL)::bigint AS latest_entry_count
    FROM cells
    GROUP BY metric_id
  `;

  const map = new Map<string, AggregateSnapshot>();
  for (const row of rows) {
    map.set(row.metric_id, mapAggregateRow(row));
  }
  return map;
}

/**
 * The new implementation, exactly as `getAlliancePerformanceReport.ts`'s
 * real (private) `queryBulkAggregates` now calls it — one multi-metric
 * `memberPeriodMetricValues` call, one roster fetch, grouped by
 * `metricId` in JS via the shared `computeAggregateSnapshot`
 * (`metricRollup.ts`).
 */
async function newQueryBulkAggregates(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricIds: string[],
  isBooleanByMetricId: ReadonlyMap<string, boolean>,
): Promise<Map<string, AggregateSnapshot>> {
  if (metricIds.length === 0) return new Map();

  const [values, roster] = await Promise.all([
    memberPeriodMetricValues(allianceId, periodId, metricIds),
    prisma.allianceMember.findMany({ where: { allianceId }, select: { id: true, archivedAt: true } }),
  ]);

  const valuesByMetric = new Map<string, { allianceMemberId: string; value: number | null }[]>();
  for (const value of values) {
    const bucket = valuesByMetric.get(value.metricId);
    if (bucket) bucket.push(value);
    else valuesByMetric.set(value.metricId, [value]);
  }

  const map = new Map<string, AggregateSnapshot>();
  for (const metricId of metricIds) {
    const isBooleanMetric = isBooleanByMetricId.get(metricId) ?? false;
    map.set(metricId, computeAggregateSnapshot(valuesByMetric.get(metricId) ?? [], roster, isBooleanMetric));
  }
  return map;
}

// #287 Slice 3 diff log: getAlliancePerformanceReport.ts's
// queryBulkAggregates, old (raw multi-metric cross join) vs new
// (memberPeriodMetricValues + computeAggregateSnapshot).
describe.skipIf(!runDb)("getAlliancePerformanceReport bulk aggregate parity [integration]", () => {
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

  it("PASS: a multi-metric bulk fetch (SUM, BOOLEAN, and an unattached metric) produces identical, mutually isolated per-metric aggregates", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Bulk Aggregate Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });

    const active1 = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Active One" } });
    const active2 = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Active Two" } });
    const archived = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Archived", archivedAt: new Date() },
    });

    const sumMetric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Donations", type: "NUMERIC" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: sumMetric.id, weight: 1, required: false },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: active1.id, periodId: period.id, metricId: sumMetric.id, value: 100 },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: archived.id, periodId: period.id, metricId: sumMetric.id, value: 25 },
    });

    const rateMetric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Showed Up", type: "BOOLEAN" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: rateMetric.id, weight: 1, required: false },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: active1.id, periodId: period.id, metricId: rateMetric.id, value: 1 },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: active2.id, periodId: period.id, metricId: rateMetric.id, value: 0 },
    });

    // Never attached, never has entries - the cross join must still
    // produce a full all-null row per member for this metric, not omit it.
    const unattachedMetric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Never Attached", type: "NUMERIC" },
    });

    const metricIds = [sumMetric.id, rateMetric.id, unattachedMetric.id];
    const isBooleanByMetricId = new Map([
      [sumMetric.id, false],
      [rateMetric.id, true],
      [unattachedMetric.id, false],
    ]);

    const [oldResult, newResult] = await Promise.all([
      oldQueryBulkAggregates(prisma, alliance.id, period.id, metricIds),
      newQueryBulkAggregates(prisma, alliance.id, period.id, metricIds, isBooleanByMetricId),
    ]);

    for (const metricId of metricIds) {
      expect(newResult.get(metricId)).toEqual(oldResult.get(metricId));
    }

    expect(newResult.get(sumMetric.id)).toMatchObject({
      sumValue: 125,
      currentActiveMemberCount: 2,
      recordedActiveMemberCount: 1,
      missingActiveMemberCount: 1,
      archivedContributingMemberCount: 1,
    });
    expect(newResult.get(rateMetric.id)).toMatchObject({ trueCount: 1, falseCount: 1, currentActiveMemberCount: 2 });
    expect(newResult.get(unattachedMetric.id)).toMatchObject({
      currentActiveMemberCount: 2,
      missingActiveMemberCount: 2,
      latestEntryCount: 0,
    });
  });

  it("EXPECTED_BREAKING: within a multi-metric batch, only the DAILY_OBSERVATION + SUM metric's total changes (correctly rolling up each member's period value) - the other metrics in the same batch are unaffected (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Bulk Daily Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Week 1",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-01-14T23:59:59.999Z"),
      },
    });
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Test Player" } });

    const legacyMetric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "Legacy Sum", type: "NUMERIC" } });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: legacyMetric.id, weight: 1, required: false },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: legacyMetric.id, value: 42 },
    });

    const dailyMetric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily Donations",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: dailyMetric.id, weight: 1, required: false },
    });
    for (const day of [6, 7, 8]) {
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: dailyMetric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date(`2026-01-0${day}T00:00:00.000Z`),
          value: 10,
          status: "ACTIVE",
        },
      });
    }

    const metricIds = [legacyMetric.id, dailyMetric.id];
    const isBooleanByMetricId = new Map([
      [legacyMetric.id, false],
      [dailyMetric.id, false],
    ]);

    const [oldResult, newResult] = await Promise.all([
      oldQueryBulkAggregates(prisma, alliance.id, period.id, metricIds),
      newQueryBulkAggregates(prisma, alliance.id, period.id, metricIds, isBooleanByMetricId),
    ]);

    // Unaffected sibling metric in the same batch: identical either way.
    expect(newResult.get(legacyMetric.id)).toEqual(oldResult.get(legacyMetric.id));
    expect(newResult.get(legacyMetric.id)!.sumValue).toBe(42);

    // Old: only the latest day's raw value (10). New: the true sum (30).
    expect(oldResult.get(dailyMetric.id)!.sumValue).toBe(10);
    expect(newResult.get(dailyMetric.id)!.sumValue).toBe(30);
  });
});
