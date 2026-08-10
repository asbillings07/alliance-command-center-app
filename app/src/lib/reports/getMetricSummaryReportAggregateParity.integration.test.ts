import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";
import type { AggregateSnapshot } from "./metricRollup";
import type { VisualCohortRow } from "./metricVisualModel";

const runDb = process.env.INTEGRATION_DB === "true";

type AggregateRawRow = {
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

function mapAggregateRow(row: AggregateRawRow): AggregateSnapshot {
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
 * The pre-#287-Slice-3 `queryAggregate`, reproduced verbatim (it no longer
 * exists in production code) so this test proves parity against the
 * *actual previous behavior*. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
async function oldQueryAggregate(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricId: string,
  isBooleanMetric: boolean,
): Promise<AggregateSnapshot> {
  const rows = await prisma.$queryRaw<AggregateRawRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("allianceMemberId") "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" = ${metricId}
      ORDER BY "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    )
    SELECT
      COALESCE(SUM(l.value) FILTER (
        WHERE l.value IS NOT NULL AND (NOT ${isBooleanMetric}::boolean OR l.value IN (0, 1))
      ), 0)::bigint AS sum_value,
      AVG(l.value) FILTER (
        WHERE l.value IS NOT NULL AND (NOT ${isBooleanMetric}::boolean OR l.value IN (0, 1))
      )::float8 AS avg_value,
      COUNT(*) FILTER (WHERE ${isBooleanMetric}::boolean AND l.value = 1)::bigint AS true_count,
      COUNT(*) FILTER (WHERE ${isBooleanMetric}::boolean AND l.value = 0)::bigint AS false_count,
      COUNT(*) FILTER (
        WHERE ${isBooleanMetric}::boolean AND l.value IS NOT NULL AND l.value NOT IN (0, 1)
      )::bigint AS invalid_count,
      COALESCE(BOOL_OR(l.value IS NOT NULL AND l.value < 0), FALSE) AS has_negative_values,
      COUNT(*) FILTER (WHERE am."archivedAt" IS NULL)::bigint AS current_active_member_count,
      COUNT(*) FILTER (
        WHERE am."archivedAt" IS NULL AND l.value IS NOT NULL
          AND (NOT ${isBooleanMetric}::boolean OR l.value IN (0, 1))
      )::bigint AS recorded_active_member_count,
      COUNT(*) FILTER (
        WHERE am."archivedAt" IS NULL AND ${isBooleanMetric}::boolean
          AND l.value IS NOT NULL AND l.value NOT IN (0, 1)
      )::bigint AS invalid_active_member_count,
      COUNT(*) FILTER (WHERE am."archivedAt" IS NULL AND l.value IS NULL)::bigint AS missing_active_member_count,
      COUNT(*) FILTER (
        WHERE am."archivedAt" IS NOT NULL AND l.value IS NOT NULL
      )::bigint AS archived_contributing_member_count,
      COUNT(*) FILTER (WHERE l.value IS NOT NULL)::bigint AS latest_entry_count
    FROM "AllianceMember" am
    LEFT JOIN latest l ON l.member_id = am.id
    WHERE am."allianceId" = ${allianceId}
  `;
  return mapAggregateRow(rows[0]!);
}

/** The pre-#287-Slice-3 `queryVisualizationRows`, reproduced verbatim. */
async function oldQueryVisualizationRows(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricId: string,
): Promise<VisualCohortRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ alliance_member_id: string; player_name: string; archived: boolean; value: number | null }>
  >`
    WITH latest AS (
      SELECT DISTINCT ON ("allianceMemberId") "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" = ${metricId}
      ORDER BY "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    )
    SELECT
      am.id AS alliance_member_id,
      am."playerName" AS player_name,
      (am."archivedAt" IS NOT NULL) AS archived,
      l.value AS value
    FROM "AllianceMember" am
    LEFT JOIN latest l ON l.member_id = am.id
    WHERE am."allianceId" = ${allianceId}
      AND (am."archivedAt" IS NULL OR l.value IS NOT NULL)
    ORDER BY am."playerName" ASC, am.id ASC
  `;
  return rows.map((row) => ({
    allianceMemberId: row.alliance_member_id,
    playerName: row.player_name,
    archived: row.archived,
    value: row.value,
  }));
}

/**
 * The new implementation's logic, reproduced here (both are private
 * helpers inside `getMetricSummaryReport.ts`) via the exact same
 * `memberPeriodMetricValues` call and roster fetch the real functions now
 * make.
 */
async function newQueryAggregate(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricId: string,
  isBooleanMetric: boolean,
): Promise<AggregateSnapshot> {
  const { memberPeriodMetricValues } = await import("@/app/src/lib/metrics/memberPeriodMetricValues");
  const [values, roster] = await Promise.all([
    memberPeriodMetricValues(allianceId, periodId, [metricId]),
    prisma.allianceMember.findMany({ where: { allianceId }, select: { id: true, archivedAt: true } }),
  ]);
  const valueByMember = new Map(values.map((row) => [row.allianceMemberId, row.value]));

  let sumValue = 0;
  let averageSum = 0;
  let averageCount = 0;
  let trueCount = 0;
  let falseCount = 0;
  let invalidCount = 0;
  let hasNegativeValues = false;
  let currentActiveMemberCount = 0;
  let recordedActiveMemberCount = 0;
  let invalidActiveMemberCount = 0;
  let missingActiveMemberCount = 0;
  let archivedContributingMemberCount = 0;
  let latestEntryCount = 0;

  for (const member of roster) {
    const archived = member.archivedAt !== null;
    const value = valueByMember.get(member.id) ?? null;
    const isValid = value !== null && (!isBooleanMetric || isValidBooleanMetricValue(value));

    if (!archived) currentActiveMemberCount++;
    if (value !== null && value < 0) hasNegativeValues = true;
    if (value !== null) latestEntryCount++;

    if (isBooleanMetric && value !== null) {
      if (value === 1) trueCount++;
      else if (value === 0) falseCount++;
      else invalidCount++;
    }

    if (isValid) {
      sumValue += value;
      averageSum += value;
      averageCount++;
    }

    if (!archived) {
      if (isValid) recordedActiveMemberCount++;
      if (isBooleanMetric && value !== null && !isValid) invalidActiveMemberCount++;
      if (value === null) missingActiveMemberCount++;
    } else if (value !== null) {
      archivedContributingMemberCount++;
    }
  }

  return {
    sumValue,
    averageValue: averageCount > 0 ? averageSum / averageCount : null,
    trueCount,
    falseCount,
    invalidCount,
    hasNegativeValues,
    currentActiveMemberCount,
    recordedActiveMemberCount,
    invalidActiveMemberCount,
    missingActiveMemberCount,
    archivedContributingMemberCount,
    latestEntryCount,
  };
}

async function newQueryVisualizationRows(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricId: string,
): Promise<VisualCohortRow[]> {
  const { memberPeriodMetricValues } = await import("@/app/src/lib/metrics/memberPeriodMetricValues");
  const [values, roster] = await Promise.all([
    memberPeriodMetricValues(allianceId, periodId, [metricId]),
    prisma.allianceMember.findMany({
      where: { allianceId },
      select: { id: true, playerName: true, archivedAt: true },
      orderBy: [{ playerName: "asc" }, { id: "asc" }],
    }),
  ]);
  const valueByMember = new Map(values.map((row) => [row.allianceMemberId, row.value]));

  return roster
    .filter((member) => member.archivedAt === null || valueByMember.get(member.id) != null)
    .map((member) => ({
      allianceMemberId: member.id,
      playerName: member.playerName,
      archived: member.archivedAt !== null,
      value: valueByMember.get(member.id) ?? null,
    }));
}

// #287 Slice 3 diff log: getMetricSummaryReport.ts's queryAggregate and
// queryVisualizationRows, old (raw DISTINCT ON) vs new
// (memberPeriodMetricValues).
describe.skipIf(!runDb)("getMetricSummaryReport aggregate/visualization parity [integration]", () => {
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

  async function makeSetup(metricType: "NUMERIC" | "BOOLEAN") {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Aggregate Parity Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Test Metric", type: metricType },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    return { alliance, period, metric };
  }

  it("PASS: a mixed-sign, mixed-participation NUMERIC cohort produces identical aggregate and visualization results", async () => {
    const { alliance, period, metric } = await makeSetup("NUMERIC");

    const contributor = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Contributor" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: contributor.id, periodId: period.id, metricId: metric.id, value: 150 },
    });

    const negativeContributor = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Negative" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: negativeContributor.id, periodId: period.id, metricId: metric.id, value: -10 },
    });

    await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "No Entry" } });

    const archivedContributor = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Archived Contributor", archivedAt: new Date() },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: archivedContributor.id, periodId: period.id, metricId: metric.id, value: 999 },
    });

    await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Archived No Entry", archivedAt: new Date() },
    });

    const [oldAggregate, newAggregate, oldVisual, newVisual] = await Promise.all([
      oldQueryAggregate(prisma, alliance.id, period.id, metric.id, false),
      newQueryAggregate(prisma, alliance.id, period.id, metric.id, false),
      oldQueryVisualizationRows(prisma, alliance.id, period.id, metric.id),
      newQueryVisualizationRows(prisma, alliance.id, period.id, metric.id),
    ]);

    expect(newAggregate).toEqual(oldAggregate);
    expect(newAggregate).toEqual({
      // 150 + (-10) + 999 (archived contributor's sum/average are NOT
      // excluded by archivedAt - only the per-active/archived *counts*
      // below are archived-aware; see queryAggregate's doc comment).
      sumValue: 1139,
      averageValue: 1139 / 3,
      trueCount: 0,
      falseCount: 0,
      invalidCount: 0,
      hasNegativeValues: true,
      currentActiveMemberCount: 3,
      recordedActiveMemberCount: 2,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 1,
      archivedContributingMemberCount: 1,
      latestEntryCount: 3,
    });
    expect(newVisual).toEqual(oldVisual);
  });

  it("PASS: a BOOLEAN metric's true/false/invalid classification matches exactly, including an archived contributor's invalid value", async () => {
    const { alliance, period, metric } = await makeSetup("BOOLEAN");

    const trueMember = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "True" } });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: trueMember.id, periodId: period.id, metricId: metric.id, value: 1 },
    });

    const falseMember = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "False" } });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: falseMember.id, periodId: period.id, metricId: metric.id, value: 0 },
    });

    const invalidArchivedMember = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Invalid Archived", archivedAt: new Date() },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: invalidArchivedMember.id, periodId: period.id, metricId: metric.id, value: 5 },
    });

    await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Missing" } });

    const [oldAggregate, newAggregate] = await Promise.all([
      oldQueryAggregate(prisma, alliance.id, period.id, metric.id, true),
      newQueryAggregate(prisma, alliance.id, period.id, metric.id, true),
    ]);

    expect(newAggregate).toEqual(oldAggregate);
    expect(newAggregate).toEqual({
      sumValue: 1,
      averageValue: 0.5,
      trueCount: 1,
      falseCount: 1,
      invalidCount: 1,
      hasNegativeValues: false,
      currentActiveMemberCount: 3,
      recordedActiveMemberCount: 2,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 1,
      archivedContributingMemberCount: 1,
      latestEntryCount: 3,
    });
  });

  it("PASS: three corrections collapse to the latest value in both the aggregate and the visualization row", async () => {
    const { alliance, period, metric } = await makeSetup("NUMERIC");
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Corrected" } });

    for (const [value, recordedAt] of [
      [10, "2026-01-01T00:00:00.000Z"],
      [30, "2026-01-03T00:00:00.000Z"],
      [20, "2026-01-02T00:00:00.000Z"],
    ] as const) {
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          value,
          recordedAt: new Date(recordedAt),
        },
      });
    }

    const [oldAggregate, newAggregate] = await Promise.all([
      oldQueryAggregate(prisma, alliance.id, period.id, metric.id, false),
      newQueryAggregate(prisma, alliance.id, period.id, metric.id, false),
    ]);

    expect(newAggregate.sumValue).toBe(30);
    expect(newAggregate).toEqual(oldAggregate);
  });

  it("EXPECTED_BREAKING: a DAILY_OBSERVATION + SUM metric's cohort total correctly sums each member's rolled-up period value, instead of only their latest single day's raw entry (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Daily Aggregate Alliance ${suffix}`, server: "1001" } });
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
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Test Player" } });

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

    const [oldAggregate, newAggregate] = await Promise.all([
      oldQueryAggregate(prisma, alliance.id, period.id, metric.id, false),
      newQueryAggregate(prisma, alliance.id, period.id, metric.id, false),
    ]);

    // Old: only the latest day's raw value (10). New: the true sum (30).
    expect(oldAggregate.sumValue).toBe(10);
    expect(newAggregate.sumValue).toBe(30);
  });
});
