import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { runInReadOnlyAuditTransaction } from "./apsAuditTransaction";
import { runApsDataReadinessAudit } from "./apsDataReadinessAudit";

const runDb = process.env.INTEGRATION_DB === "true";

/**
 * The pre-#287-Slice-3 `queryCoverageAndDistribution`, reproduced verbatim
 * (it no longer exists in production code) so this test proves parity
 * against the *actual previous behavior*, not a hand description of it. See
 * `docs/database-design/287-slice3-consumer-parity-log.md` for the
 * scenario-by-scenario diff log this test backs.
 */
async function oldQueryCoverageAndDistribution(
  prisma: PrismaClient,
  allianceId: string,
  periodId: string,
  metricIds: string[],
): Promise<
  Array<{
    metric_id: string;
    recorded_active_member_count: bigint;
    missing_active_member_count: bigint;
    numeric_valid_count: bigint;
    min_value: number | null;
    max_value: number | null;
  }>
> {
  return prisma.$queryRaw`
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
      WHERE id IN (${Prisma.join(metricIds)}) AND "allianceId" = ${allianceId}
    ),
    cells AS (
      SELECT
        mt.metric_id,
        mt.is_boolean,
        am.id AS member_id,
        (am."archivedAt" IS NULL) AS is_active,
        l.value,
        (l.value IS NOT NULL AND (NOT mt.is_boolean OR l.value IN (0, 1))) AS is_valid
      FROM metric_types mt
      CROSS JOIN "AllianceMember" am
      LEFT JOIN latest l ON l.metric_id = mt.metric_id AND l.member_id = am.id
      WHERE am."allianceId" = ${allianceId}
    )
    SELECT
      c.metric_id,
      COUNT(*) FILTER (WHERE c.is_active AND c.is_valid)::bigint AS recorded_active_member_count,
      COUNT(*) FILTER (WHERE c.is_active AND c.value IS NULL)::bigint AS missing_active_member_count,
      COUNT(*) FILTER (WHERE c.is_valid AND NOT c.is_boolean)::bigint AS numeric_valid_count,
      MIN(c.value) FILTER (WHERE c.is_valid AND NOT c.is_boolean) AS min_value,
      MAX(c.value) FILTER (WHERE c.is_valid AND NOT c.is_boolean) AS max_value
    FROM cells c
    GROUP BY c.metric_id
  `;
}

/**
 * The pre-#287-Slice-3 `queryPeriodsWithValidDataCounts`, reproduced
 * verbatim (single `DISTINCT ON (period, metric, member)` by `recordedAt`,
 * no `observedOn` partitioning).
 */
async function oldQueryPeriodsWithValidDataCounts(
  prisma: PrismaClient,
  allianceId: string,
  metricIds: string[],
): Promise<Array<{ metric_id: string; periods_with_valid_data_count: bigint }>> {
  return prisma.$queryRaw`
    WITH attached_periods AS (
      SELECT DISTINCT mpm."periodId" AS period_id, mpm."metricId" AS metric_id
      FROM "MetricPeriodMetric" mpm
      JOIN "MetricPeriod" mp ON mp.id = mpm."periodId" AND mp."allianceId" = ${allianceId}
      WHERE mpm."metricId" IN (${Prisma.join(metricIds)}) AND mpm.active = true
    ),
    latest AS (
      SELECT DISTINCT ON (mme."periodId", mme."metricId", mme."allianceMemberId")
        mme."periodId" AS period_id, mme."metricId" AS metric_id, mme.value
      FROM "MemberMetricEntry" mme
      JOIN attached_periods ap ON ap.period_id = mme."periodId" AND ap.metric_id = mme."metricId"
      JOIN "AllianceMember" am ON am.id = mme."allianceMemberId" AND am."allianceId" = ${allianceId}
      ORDER BY mme."periodId", mme."metricId", mme."allianceMemberId", mme."recordedAt" DESC, mme."createdAt" DESC, mme.id DESC
    ),
    metric_types AS (
      SELECT id AS metric_id, (type = 'BOOLEAN'::"Metric_Type") AS is_boolean
      FROM "Metric"
      WHERE id IN (${Prisma.join(metricIds)}) AND "allianceId" = ${allianceId}
    ),
    valid_periods AS (
      SELECT DISTINCT l.period_id, l.metric_id
      FROM latest l
      JOIN metric_types mt ON mt.metric_id = l.metric_id
      WHERE l.value IS NOT NULL AND (NOT mt.is_boolean OR l.value IN (0, 1))
    )
    SELECT metric_id, COUNT(*)::bigint AS periods_with_valid_data_count
    FROM valid_periods
    GROUP BY metric_id
  `;
}

// #287 Slice 3 diff log: apsDataReadinessAudit.ts's coverage/distribution and
// dogfood-readiness queries, old (raw per-metric DISTINCT ON, no ADR-018
// slot/status resolution) vs new (buildMemberPeriodValueCte for coverage;
// an inline two-phase slot_winner/active_slots resolution, generalized
// across periods, for dogfood readiness).
describe.skipIf(!runDb)("apsDataReadinessAudit coverage/dogfood parity [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({ where: { allianceMember: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  it("PASS: a voided-then-nothing-else entry is treated identically by both implementations for a PERIOD_VALUE metric (the DB CHECK constraint already made this a non-issue pre-migration)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `APS Coverage Parity Alliance ${suffix}`, server: "9999" } });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08"), active: true },
    });
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Fixture Metric", type: "NUMERIC", summaryKind: "SUM" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false, active: true },
    });

    // 5 members with normal valid entries, and 5 genuinely-missing members
    // (no entry at all) -- both populations comfortably at/above
    // MIN_CELL_SIZE, and no accidental small correlated cell (e.g. an
    // isolated single missing member) that would trip suppression.
    const recorded = await Promise.all(
      Array.from({ length: 5 }, (_, i) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Recorded ${i}` } })),
    );
    await Promise.all(
      recorded.map((m, i) => prisma.memberMetricEntry.create({ data: { allianceMemberId: m.id, periodId: period.id, metricId: metric.id, value: i + 1 } })),
    );
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Missing ${i}` } })),
    );

    // One member submitted, then voided, and never corrected -- must count
    // as missing under both implementations (joins the 4 above to keep
    // missingActiveMemberCount at 5, not an isolated small cell of 1).
    const voidedOnly = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Voided Only" } });
    const original = await prisma.memberMetricEntry.create({
      data: { allianceMemberId: voidedOnly.id, periodId: period.id, metricId: metric.id, value: 99 },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: voidedOnly.id,
        periodId: period.id,
        metricId: metric.id,
        value: null,
        status: "VOIDED",
        recordedAt: new Date(original.recordedAt.getTime() + 1000),
      },
    });

    const oldRows = await oldQueryCoverageAndDistribution(prisma, alliance.id, period.id, [metric.id]);
    const report = await runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, [alliance.id]));
    const newRow = report.alliances[0]!.metricDistributions[0]!;

    expect(newRow.stats.suppressed).toBe(false);
    if (newRow.stats.suppressed) return;

    // Both implementations agree: 5 recorded, 5 missing (4 genuinely-empty + the voided-only member).
    expect(Number(oldRows[0]!.recorded_active_member_count)).toBe(5);
    expect(Number(oldRows[0]!.missing_active_member_count)).toBe(5);
    expect(newRow.stats.value.coverage.recordedActiveMemberCount).toBe(5);
    expect(newRow.stats.value.coverage.missingActiveMemberCount).toBe(5);
  });

  it("EXPECTED_BREAKING: a DAILY_OBSERVATION + SUM metric's distribution reflects the true rolled-up sum, not just the latest-recorded day's raw value (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `APS Daily Coverage Parity Alliance ${suffix}`, server: "9999" } });
    createdAllianceIds.push(alliance.id);

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Week 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-14"), active: true },
    });
    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily Donations",
        type: "NUMERIC",
        summaryKind: "SUM",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false, active: true },
    });

    // 6 members, each recording the SAME three-day pattern (5 + 5 + 5,
    // entered in normal chronological order) -- uniform across the cohort
    // so the distribution has zero spread (no outlier-flagging risk from an
    // isolated value), comfortably at MIN_CELL_SIZE, and isolates exactly
    // one variable: true rolled-up sum (15) vs. the latest single day's raw
    // value (5).
    const members = await Promise.all(
      Array.from({ length: 6 }, (_, i) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Daily Donor ${i}` } })),
    );
    for (const member of members) {
      for (const day of [6, 7, 8]) {
        await prisma.memberMetricEntry.create({
          data: {
            allianceMemberId: member.id,
            periodId: period.id,
            metricId: metric.id,
            observationGrain: "DAILY_OBSERVATION",
            observedOn: new Date(`2026-01-0${day}T00:00:00.000Z`),
            value: 5,
          },
        });
      }
    }

    const oldRows = await oldQueryCoverageAndDistribution(prisma, alliance.id, period.id, [metric.id]);
    const report = await runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, [alliance.id]));
    const newRow = report.alliances[0]!.metricDistributions[0]!;

    expect(newRow.stats.suppressed).toBe(false);
    if (newRow.stats.suppressed) return;
    const section = newRow.stats.value.section;
    if (section.kind !== "NUMERIC" || section.distribution === null) throw new Error("expected a numeric distribution");

    // Old: every member's raw picked row is day 8's (latest recordedAt), value 5.
    expect(Number(oldRows[0]!.min_value)).toBe(5);
    expect(Number(oldRows[0]!.max_value)).toBe(5);
    // New: every member's true rolled-up sum is 15 (5+5+5), not 5.
    expect(section.distribution.min).toBe(15);
    expect(section.distribution.max).toBe(15);
    expect(section.distribution.outlierCount).toBe(0);
  });

  it("EXPECTED_BREAKING: dogfood readiness sees an EARLIER day's still-active data even when a LATER day in the same period was voided (inert today - no leader can create a DAILY_OBSERVATION metric yet)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `APS Dogfood Parity Alliance ${suffix}`, server: "9999" } });
    createdAllianceIds.push(alliance.id);

    const periods = await Promise.all(
      [
        { name: "Week 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") },
        { name: "Week 2", startsAt: new Date("2026-01-09"), endsAt: new Date("2026-01-16") },
        { name: "Week 3", startsAt: new Date("2026-01-17"), endsAt: new Date("2026-01-24") },
      ].map((data) => prisma.metricPeriod.create({ data: { allianceId: alliance.id, active: true, ...data } })),
    );
    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily Metric",
        type: "NUMERIC",
        summaryKind: "SUM",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "LATEST",
      },
    });
    await Promise.all(
      periods.map((p) => prisma.metricPeriodMetric.create({ data: { periodId: p.id, metricId: metric.id, weight: 1, required: false, active: true } })),
    );

    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Backfiller" } });

    // Week 1 & 2: a normal, single valid entry -- both implementations
    // agree these periods have valid data.
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: periods[0]!.id, metricId: metric.id, observationGrain: "DAILY_OBSERVATION", observedOn: new Date("2026-01-02T00:00:00.000Z"), value: 1 },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: periods[1]!.id, metricId: metric.id, observationGrain: "DAILY_OBSERVATION", observedOn: new Date("2026-01-10T00:00:00.000Z"), value: 1 },
    });

    // Week 3: an EARLIER day (18) has a normal, still-active valid entry.
    // A LATER day (20) was recorded, then voided (a real correction
    // workflow, not a hypothetical) -- the void tombstone has the single
    // latest `recordedAt` across every row in the period/metric/member.
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: periods[2]!.id, metricId: metric.id, observationGrain: "DAILY_OBSERVATION", observedOn: new Date("2026-01-18T00:00:00.000Z"), value: 1 },
    });
    const day20Original = await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: periods[2]!.id, metricId: metric.id, observationGrain: "DAILY_OBSERVATION", observedOn: new Date("2026-01-20T00:00:00.000Z"), value: 5 },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: periods[2]!.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-20T00:00:00.000Z"),
        value: null,
        status: "VOIDED",
        recordedAt: new Date(day20Original.recordedAt.getTime() + 1000),
      },
    });

    const oldRows = await oldQueryPeriodsWithValidDataCounts(prisma, alliance.id, [metric.id]);
    const report = await runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, [alliance.id]));
    const dogfood = report.alliances[0]!.dogfoodReadiness;

    // Old: a single DISTINCT ON (period, metric, member) by recordedAt --
    // with no per-day concept -- picks the day-20 void tombstone for week 3
    // (it's the single latest row overall), sees a null value, and wrongly
    // concludes week 3 has NO valid data at all, even though day 18's entry
    // is still perfectly active and valid. Only 2/3 periods look valid.
    expect(Number(oldRows[0]!.periods_with_valid_data_count)).toBe(2);

    // New: day 18 and day 20 are resolved as independent slots first: day
    // 20's slot correctly resolves to VOIDED (excluded), but day 18's slot
    // is untouched and still contributes -- so week 3 correctly counts as
    // having valid data. All 3/3 periods are valid, clearing
    // MIN_PERIODS_FOR_DOGFOOD (3).
    expect(dogfood.totalMetricCount).toBe(1);
    expect(dogfood.metricsWithEnoughObservationsCount).toBe(1);
  });
});
