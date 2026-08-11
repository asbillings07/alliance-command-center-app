import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { getMetricSummaryReport, type MetricReportSort, type MemberRosterFilter } from "./getMetricSummaryReport";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The pre-#287-Slice-3 `buildRosterCte`/`buildRosterFromWhere`/
 * `buildRosterOrderBy` roster query, reproduced verbatim (it no longer
 * exists in production code) so this test proves parity against the
 * *actual previous behavior*, not a hand description of it. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
function oldBuildRosterFromWhere(params: {
  allianceId: string;
  filter: MemberRosterFilter;
  searchPattern: string;
}): Prisma.Sql {
  const { allianceId, filter, searchPattern } = params;
  return Prisma.sql`
    FROM "AllianceMember" am
    LEFT JOIN latest l ON l.member_id = am.id
    LEFT JOIN ranked r ON r.member_id = am.id
    WHERE am."allianceId" = ${allianceId}
      AND (
        (${filter}::text = 'active' AND am."archivedAt" IS NULL)
        OR (${filter}::text = 'archived' AND am."archivedAt" IS NOT NULL AND l.value IS NOT NULL)
        OR (${filter}::text = 'all' AND (am."archivedAt" IS NULL OR l.value IS NOT NULL))
      )
      AND (${searchPattern}::text = '' OR am."playerName" ILIKE ${searchPattern} ESCAPE '\\')
  `;
}

function oldBuildRosterOrderBy(sort: MetricReportSort, isBooleanMetric: boolean): Prisma.Sql {
  const effectiveValue = Prisma.sql`(
    CASE
      WHEN ${isBooleanMetric}::boolean AND l.value IS NOT NULL AND l.value NOT IN (0, 1) THEN NULL
      ELSE l.value
    END
  )`;
  switch (sort) {
    case "value_asc":
      return Prisma.sql`${effectiveValue} ASC NULLS LAST, am."playerName" ASC, am.id ASC`;
    case "name_asc":
      return Prisma.sql`am."playerName" ASC, am.id ASC`;
    case "value_desc":
    default:
      return Prisma.sql`${effectiveValue} DESC NULLS LAST, am."playerName" ASC, am.id ASC`;
  }
}

async function oldQueryRosterRows(
  prisma: PrismaClient,
  params: {
    allianceId: string;
    periodId: string;
    metricId: string;
    isBooleanMetric: boolean;
    filter: MemberRosterFilter;
    searchPattern: string;
  },
  sort: MetricReportSort,
): Promise<Array<{ alliance_member_id: string; player_name: string; archived: boolean; value: number | null; rank: bigint | null }>> {
  const { periodId, metricId, isBooleanMetric } = params;
  return prisma.$queryRaw<
    Array<{ alliance_member_id: string; player_name: string; archived: boolean; value: number | null; rank: bigint | null }>
  >`
    WITH latest AS (
      SELECT DISTINCT ON ("allianceMemberId") "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" = ${metricId}
      ORDER BY "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    ),
    ranked AS (
      SELECT member_id, RANK() OVER (ORDER BY value DESC) AS rank
      FROM latest
      WHERE value IS NOT NULL AND (NOT ${isBooleanMetric}::boolean OR value IN (0, 1))
    )
    SELECT
      am.id AS alliance_member_id,
      am."playerName" AS player_name,
      (am."archivedAt" IS NOT NULL) AS archived,
      l.value AS value,
      r.rank AS rank
    ${oldBuildRosterFromWhere({ allianceId: params.allianceId, filter: params.filter, searchPattern: params.searchPattern })}
    ORDER BY ${oldBuildRosterOrderBy(sort, isBooleanMetric)}
  `;
}

// #287 Slice 3 diff log: getMetricSummaryReport.ts's paginated roster query
// (ranking + archived-inclusion + sort), old (raw DISTINCT ON) vs new
// (buildMemberPeriodValueCte, ADR-018 §6).
describe.skipIf(!runDb)("getMetricSummaryReport roster parity [integration]", () => {
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

  it("PASS: ranking, archived-inclusion (with a voided-only entry), and value-desc sort match the old implementation exactly for a PERIOD_VALUE+LATEST metric", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Summary Roster Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    const top = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Top" } });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: top.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    // Archived + has a value -> included under "archived"/"all".
    const archivedWithData = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Archived Contributor", archivedAt: new Date() },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: archivedWithData.id, periodId: period.id, metricId: metric.id, value: 40 },
    });

    // Archived + only a voided entry -> excluded from "archived"/"all" under
    // both old and new (`l.value IS NOT NULL` requires a real value).
    const archivedVoidedOnly = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Archived Voided Only", archivedAt: new Date() },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: archivedVoidedOnly.id,
        periodId: period.id,
        metricId: metric.id,
        value: null,
        status: "VOIDED",
      },
    });

    const queryParams = {
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      isBooleanMetric: false,
      filter: "all" as MemberRosterFilter,
      searchPattern: "",
    };

    const oldRows = await oldQueryRosterRows(prisma, queryParams, "value_desc");
    const newResult = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      filter: "all",
      sort: "value_desc",
      pageSize: 50,
    });

    const oldById = new Map(oldRows.map((r) => [r.alliance_member_id, r]));
    const newIds = newResult.rows.map((r) => r.allianceMemberId);

    expect(newIds).toEqual(oldRows.map((r) => r.alliance_member_id));
    expect(newIds).toContain(top.id);
    expect(newIds).toContain(archivedWithData.id);
    expect(newIds).not.toContain(archivedVoidedOnly.id);

    for (const row of newResult.rows) {
      const oldRow = oldById.get(row.allianceMemberId);
      expect(row.value).toBe(oldRow?.value ?? null);
      expect(row.rank).toBe(oldRow?.rank === null || oldRow?.rank === undefined ? null : Number(oldRow.rank));
    }
  });

  it("EXPECTED_BREAKING: a DAILY_OBSERVATION + SUM metric's rank/sort/archived-inclusion use the true rolled-up sum, not just the latest day's raw value (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Summary Roster Daily Parity Alliance ${suffix}`, server: "1001" },
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

    // Low latest-day value (5) but a high true sum (5+5+5=15).
    const highSumLowLatest = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "High Sum Low Latest" },
    });
    for (const day of [6, 7, 8]) {
      await prisma.memberMetricEntry.create({
        data: {
          allianceMemberId: highSumLowLatest.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date(`2026-01-0${day}T00:00:00.000Z`),
          value: 5,
          status: "ACTIVE",
        },
      });
    }

    // High latest-day value (10, single day) but a lower true sum (10).
    const singleObservation = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Single Observation" },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: singleObservation.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-09T00:00:00.000Z"),
        value: 10,
        status: "ACTIVE",
      },
    });

    const queryParams = {
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      isBooleanMetric: false,
      filter: "all" as MemberRosterFilter,
      searchPattern: "",
    };

    const oldRows = await oldQueryRosterRows(prisma, queryParams, "value_desc");
    const newResult = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      filter: "all",
      sort: "value_desc",
      pageSize: 50,
    });

    const oldIds = oldRows.map((r) => r.alliance_member_id);
    const newIds = newResult.rows.map((r) => r.allianceMemberId);

    // Old (latest-day-only): singleObservation (10) outranks highSumLowLatest (5).
    expect(oldIds.indexOf(singleObservation.id)).toBeLessThan(oldIds.indexOf(highSumLowLatest.id));
    // New (true sum): highSumLowLatest (15) outranks singleObservation (10).
    expect(newIds.indexOf(highSumLowLatest.id)).toBeLessThan(newIds.indexOf(singleObservation.id));
    expect(newIds).not.toEqual(oldIds);

    const newHighSumRow = newResult.rows.find((r) => r.allianceMemberId === highSumLowLatest.id);
    const newSingleRow = newResult.rows.find((r) => r.allianceMemberId === singleObservation.id);
    expect(newHighSumRow?.value).toBe(15);
    expect(newHighSumRow?.rank).toBe(1);
    expect(newSingleRow?.value).toBe(10);
    expect(newSingleRow?.rank).toBe(2);
  });

  it("PASS: name sort and search are unaffected (buildRosterFromWhere/buildRosterOrderBy are unchanged by this migration)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Summary Roster Name Sort Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    const zed = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Zed" } });
    const anna = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Anna" } });

    const queryParams = {
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      isBooleanMetric: false,
      filter: "active" as MemberRosterFilter,
      searchPattern: "",
    };

    const oldRows = await oldQueryRosterRows(prisma, queryParams, "name_asc");
    const newResult = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      filter: "active",
      sort: "name_asc",
      pageSize: 50,
    });

    const oldIds = oldRows.map((r) => r.alliance_member_id);
    const newIds = newResult.rows.map((r) => r.allianceMemberId);

    expect(newIds).toEqual(oldIds);
    expect(newIds).toEqual([anna.id, zed.id]);
  });
});
