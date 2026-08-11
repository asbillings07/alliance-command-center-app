import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { getAllianceMemberMetricMatrix } from "./getAllianceMemberMetricMatrix";
import type { MatrixColumnCandidate } from "./allianceMemberMatrix";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The pre-#287-Slice-3 `buildMatrixCte`/`buildMatrixFromWhere`/
 * `buildMatrixOrderBy` roster query, reproduced verbatim (it no longer
 * exists in production code) so this test proves parity against the
 * *actual previous behavior*, not a hand description of it. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
function oldBuildMatrixFromWhere(params: {
  allianceId: string;
  filter: "active" | "archived" | "all";
  searchPattern: string;
  sortMetricId: string | null;
}): Prisma.Sql {
  const { allianceId, filter, searchPattern, sortMetricId } = params;
  return Prisma.sql`
    FROM "AllianceMember" am
    LEFT JOIN selected_values sv ON sv.member_id = am.id AND sv.metric_id = ${sortMetricId}
    WHERE am."allianceId" = ${allianceId}
      AND (
        (${filter}::text = 'active' AND am."archivedAt" IS NULL)
        OR (${filter}::text = 'archived' AND am."archivedAt" IS NOT NULL AND EXISTS (
          SELECT 1 FROM member_has_selected_value h WHERE h.member_id = am.id
        ))
        OR (${filter}::text = 'all' AND (am."archivedAt" IS NULL OR EXISTS (
          SELECT 1 FROM member_has_selected_value h WHERE h.member_id = am.id
        )))
      )
      AND (${searchPattern}::text = '' OR am."playerName" ILIKE ${searchPattern} ESCAPE '\\')
  `;
}

function oldBuildMatrixOrderBy(
  sort: { kind: "name" | "metric"; direction: "asc" | "desc" },
  isBoolean: boolean,
): Prisma.Sql {
  if (sort.kind === "name") {
    return sort.direction === "desc"
      ? Prisma.sql`am."playerName" DESC, am.id ASC`
      : Prisma.sql`am."playerName" ASC, am.id ASC`;
  }
  const tier = Prisma.sql`(
    CASE
      WHEN sv.value IS NULL THEN 2
      WHEN ${isBoolean}::boolean AND sv.value NOT IN (0, 1) THEN 1
      ELSE 0
    END
  )`;
  const orderableValue = Prisma.sql`(CASE WHEN ${tier} = 0 THEN sv.value END)`;
  return sort.direction === "desc"
    ? Prisma.sql`${tier} ASC, ${orderableValue} DESC NULLS LAST, am."playerName" ASC, am.id ASC`
    : Prisma.sql`${tier} ASC, ${orderableValue} ASC NULLS LAST, am."playerName" ASC, am.id ASC`;
}

async function oldQueryMatrixRoster(
  prisma: PrismaClient,
  params: {
    allianceId: string;
    periodId: string;
    columnIds: string[];
    filter: "active" | "archived" | "all";
    searchPattern: string;
    sort: { kind: "name" | "metric"; direction: "asc" | "desc"; metricId?: string };
    isBoolean: boolean;
  },
): Promise<Array<{ alliance_member_id: string; player_name: string; archived: boolean }>> {
  const { periodId, columnIds, sort } = params;
  const sortMetricId = sort.kind === "metric" ? (sort.metricId ?? null) : null;
  return prisma.$queryRaw<Array<{ alliance_member_id: string; player_name: string; archived: boolean }>>`
    WITH selected_values AS (
      SELECT DISTINCT ON ("metricId", "allianceMemberId")
        "metricId" AS metric_id, "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" IN (${Prisma.join(columnIds)})
      ORDER BY "metricId", "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    ),
    member_has_selected_value AS (
      SELECT DISTINCT member_id FROM selected_values WHERE value IS NOT NULL
    )
    SELECT am.id AS alliance_member_id, am."playerName" AS player_name, (am."archivedAt" IS NOT NULL) AS archived
    ${oldBuildMatrixFromWhere({
      allianceId: params.allianceId,
      filter: params.filter,
      searchPattern: params.searchPattern,
      sortMetricId,
    })}
    ORDER BY ${oldBuildMatrixOrderBy(sort, params.isBoolean)}
  `;
}

function candidate(metricId: string, name: string, type: "NUMERIC" | "BOOLEAN" = "NUMERIC"): MatrixColumnCandidate {
  return { id: metricId, name, type, unitLabel: null, attachmentStatus: "ACTIVE", metricActive: true };
}

// #287 Slice 3 diff log: getAllianceMemberMetricMatrix.ts's roster query
// (archived-inclusion + metric-sort tiering), old (raw DISTINCT ON) vs new
// (buildMemberPeriodValueCte, ADR-018 §6).
describe.skipIf(!runDb)("getAllianceMemberMetricMatrix roster parity [integration]", () => {
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

  it("PASS: archived-inclusion and metric-sort tiering match the old implementation exactly for a PERIOD_VALUE+LATEST metric, including a voided-only entry", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Matrix Roster Parity Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "Week 1" } });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kill Points", type: "NUMERIC" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    const active = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Active Player" },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: active.id, periodId: period.id, metricId: metric.id, value: 50 },
    });

    // Archived + has a currently-selected-column value -> included under "all"/"archived".
    const archivedWithData = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Archived Contributor", archivedAt: new Date() },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: archivedWithData.id, periodId: period.id, metricId: metric.id, value: 20 },
    });

    // Archived + only a voided entry for the selected column -> excluded from
    // "archived"/"all" under both old and new (member_has_selected_value
    // requires a non-null value).
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
      columnIds: [metric.id],
      filter: "all" as const,
      searchPattern: "",
      sort: { kind: "metric" as const, direction: "desc" as const, metricId: metric.id },
      isBoolean: false,
    };

    const oldRoster = await oldQueryMatrixRoster(prisma, queryParams);
    const newResult = await getAllianceMemberMetricMatrix({
      allianceId: alliance.id,
      periodId: period.id,
      candidates: [candidate(metric.id, "Kill Points")],
      filter: "all",
      sort: metric.id,
      sortDirection: "desc",
      requestedColumnIds: [metric.id],
      pageSize: 50,
    });

    const oldIds = oldRoster.map((r) => r.alliance_member_id);
    const newIds = newResult.rows.map((r) => r.allianceMemberId);

    expect(newIds).toEqual(oldIds);
    expect(newIds).toContain(active.id);
    expect(newIds).toContain(archivedWithData.id);
    expect(newIds).not.toContain(archivedVoidedOnly.id);
    // Metric-sort desc: 50 (active) before 20 (archivedWithData).
    expect(newIds.indexOf(active.id)).toBeLessThan(newIds.indexOf(archivedWithData.id));
  });

  it("EXPECTED_BREAKING: a DAILY_OBSERVATION + SUM metric's archived-inclusion and sort tier use the true rolled-up sum, not just the latest day's raw value (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Matrix Roster Daily Parity Alliance ${suffix}`, server: "1001" },
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
      columnIds: [metric.id],
      filter: "all" as const,
      searchPattern: "",
      sort: { kind: "metric" as const, direction: "desc" as const, metricId: metric.id },
      isBoolean: false,
    };

    const oldRoster = await oldQueryMatrixRoster(prisma, queryParams);
    const newResult = await getAllianceMemberMetricMatrix({
      allianceId: alliance.id,
      periodId: period.id,
      candidates: [candidate(metric.id, "Daily Donations")],
      filter: "all",
      sort: metric.id,
      sortDirection: "desc",
      requestedColumnIds: [metric.id],
      pageSize: 50,
    });

    const oldIds = oldRoster.map((r) => r.alliance_member_id);
    const newIds = newResult.rows.map((r) => r.allianceMemberId);

    // Old (latest-day-only): singleObservation (10) sorts above highSumLowLatest (5).
    expect(oldIds.indexOf(singleObservation.id)).toBeLessThan(oldIds.indexOf(highSumLowLatest.id));
    // New (true sum): highSumLowLatest (15) sorts above singleObservation (10).
    expect(newIds.indexOf(highSumLowLatest.id)).toBeLessThan(newIds.indexOf(singleObservation.id));
    expect(newIds).not.toEqual(oldIds);
  });

  it("PASS: name sort and search are unaffected (buildMatrixFromWhere/buildMatrixOrderBy are unchanged by this migration)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Matrix Roster Name Sort Parity Alliance ${suffix}`, server: "1001" },
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
      columnIds: [metric.id],
      filter: "active" as const,
      searchPattern: "",
      sort: { kind: "name" as const, direction: "asc" as const },
      isBoolean: false,
    };

    const oldRoster = await oldQueryMatrixRoster(prisma, queryParams);
    const newResult = await getAllianceMemberMetricMatrix({
      allianceId: alliance.id,
      periodId: period.id,
      candidates: [candidate(metric.id, "Kill Points")],
      filter: "active",
      sort: "name",
      sortDirection: "asc",
      requestedColumnIds: [metric.id],
      pageSize: 50,
    });

    const oldIds = oldRoster.map((r) => r.alliance_member_id);
    const newIds = newResult.rows.map((r) => r.allianceMemberId);

    expect(newIds).toEqual(oldIds);
    expect(newIds).toEqual([anna.id, zed.id]);
  });
});
