import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { getMetricSummaryReport } from "./getMetricSummaryReport";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("getMetricSummaryReport [integration]", () => {
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

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Metric Report Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function makeMember(allianceId: string, playerName: string, archived = false) {
    return prisma.allianceMember.create({
      data: { allianceId, playerName, archivedAt: archived ? new Date("2026-01-01") : null },
    });
  }

  async function makePeriod(
    allianceId: string,
    name: string,
    dates?: { startsAt: Date; endsAt: Date },
  ) {
    return prisma.metricPeriod.create({
      data: { allianceId, name, startsAt: dates?.startsAt, endsAt: dates?.endsAt },
    });
  }

  async function makeMetric(
    allianceId: string,
    name: string,
    type: Metric_Type,
    summaryKind: MetricSummaryKind,
  ) {
    return prisma.metric.create({ data: { allianceId, name, type, summaryKind } });
  }

  async function attach(periodId: string, metricId: string, active = true) {
    return prisma.metricPeriodMetric.create({
      data: { periodId, metricId, weight: 1, required: false, active },
    });
  }

  async function addEntry(
    allianceMemberId: string,
    periodId: string,
    metricId: string,
    value: number,
    at: Date,
  ) {
    return prisma.memberMetricEntry.create({
      data: { allianceMemberId, periodId, metricId, value, recordedAt: at, createdAt: at },
    });
  }

  /**
   * Full control over recordedAt/createdAt/id independently, for exercising
   * the "latest entry" tie-break precedence
   * (`recordedAt DESC, createdAt DESC, id DESC`) one column at a time.
   */
  async function addEntryWithTiebreak(params: {
    id?: string;
    allianceMemberId: string;
    periodId: string;
    metricId: string;
    value: number;
    recordedAt: Date;
    createdAt: Date;
  }) {
    return prisma.memberMetricEntry.create({
      data: {
        id: params.id,
        allianceMemberId: params.allianceMemberId,
        periodId: params.periodId,
        metricId: params.metricId,
        value: params.value,
        recordedAt: params.recordedAt,
        createdAt: params.createdAt,
      },
    });
  }

  it("uses the latest entry per member (never sums correction history) for the SUM rollup", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    // Three corrections for the same member/period: only the latest (500) should count.
    await addEntry(member.id, period.id, metric.id, 100, new Date("2026-03-01T10:00:00Z"));
    await addEntry(member.id, period.id, metric.id, 999, new Date("2026-03-01T11:00:00Z"));
    await addEntry(member.id, period.id, metric.id, 500, new Date("2026-03-01T12:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    expect(report.rollup).toEqual({ kind: "SUM", total: 500, hasNegativeValues: false });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ allianceMemberId: member.id, value: 500, rank: 1 });
  });

  it("breaks a recordedAt tie by createdAt, not by id, for the latest-entry pick", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    const recordedAt = new Date("2026-03-01T10:00:00Z");
    // Deliberately give the createdAt-loser the lexically *larger* id, so
    // this test only passes if createdAt is genuinely compared before id —
    // an implementation that (incorrectly) tie-broke by id first would pick
    // this row and fail the assertion below.
    await addEntryWithTiebreak({
      id: "zz-tiebreak-recordedat-loser",
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      value: 100,
      recordedAt,
      createdAt: new Date("2026-03-01T09:00:00Z"),
    });
    await addEntryWithTiebreak({
      id: "aa-tiebreak-recordedat-winner",
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      value: 500,
      recordedAt,
      createdAt: new Date("2026-03-01T09:30:00Z"),
    });

    const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

    expect(report.rows[0]).toMatchObject({ allianceMemberId: member.id, value: 500 });
  });

  it("breaks a recordedAt + createdAt tie by id descending, for the latest-entry pick", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    const timestamp = new Date("2026-03-01T10:00:00Z");
    await addEntryWithTiebreak({
      id: "aa-tiebreak-id-loser",
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      value: 100,
      recordedAt: timestamp,
      createdAt: timestamp,
    });
    await addEntryWithTiebreak({
      id: "zz-tiebreak-id-winner",
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      value: 500,
      recordedAt: timestamp,
      createdAt: timestamp,
    });

    const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

    expect(report.rows[0]).toMatchObject({ allianceMemberId: member.id, value: 500 });
  });

  it("includes archived contributors in the total, shows a missing member as null, and honors the active-only default filter", async () => {
    const alliance = await makeAlliance();
    const activeContributor = await makeMember(alliance.id, "Active Contributor");
    const activeMissing = await makeMember(alliance.id, "Active Missing");
    const archivedContributor = await makeMember(alliance.id, "Archived Contributor", true);
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Donations", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    await addEntry(activeContributor.id, period.id, metric.id, 100, new Date("2026-03-01T10:00:00Z"));
    await addEntry(archivedContributor.id, period.id, metric.id, 50, new Date("2026-03-01T10:00:00Z"));

    const defaultFilterReport = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    // Total reconciles across the whole cohort, including the now-archived contributor.
    expect(defaultFilterReport.rollup).toEqual({ kind: "SUM", total: 150, hasNegativeValues: false });
    expect(defaultFilterReport.coverage.archivedContributingMemberCount).toBe(1);
    expect(defaultFilterReport.coverage.currentActiveMemberCount).toBe(2);
    expect(defaultFilterReport.coverage.missingActiveMemberCount).toBe(1);
    expect(defaultFilterReport.coverage.complete).toBe(false);

    // Default filter is "active" — the archived contributor is hidden from the visible rows...
    const activeIds = defaultFilterReport.rows.map((row) => row.allianceMemberId).sort();
    expect(activeIds).toEqual([activeContributor.id, activeMissing.id].sort());
    const missingRow = defaultFilterReport.rows.find((row) => row.allianceMemberId === activeMissing.id);
    expect(missingRow?.value).toBeNull();
    expect(missingRow?.rank).toBeNull();

    // ...but is visible under filter=all, without changing the total above.
    const allFilterReport = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      filter: "all",
    });
    expect(allFilterReport.rollup).toEqual(defaultFilterReport.rollup);
    const allIds = allFilterReport.rows.map((row) => row.allianceMemberId).sort();
    expect(allIds).toEqual([activeContributor.id, activeMissing.id, archivedContributor.id].sort());
  });

  it("treats a mixed-sign cohort's per-row share as unavailable even though the total is positive", async () => {
    const alliance = await makeAlliance();
    const positive = await makeMember(alliance.id, "Positive");
    const negative = await makeMember(alliance.id, "Negative");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Net Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    await addEntry(positive.id, period.id, metric.id, 110, new Date("2026-03-01T10:00:00Z"));
    await addEntry(negative.id, period.id, metric.id, -10, new Date("2026-03-01T10:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    expect(report.rollup).toEqual({ kind: "SUM", total: 100, hasNegativeValues: true });
    for (const row of report.rows) {
      expect(row.share).toEqual({ available: false, reason: "NEGATIVE_VALUES_PRESENT" });
    }
  });

  it("classifies a legacy out-of-range boolean value as INVALID, excluding it from the rate and ranking", async () => {
    const alliance = await makeAlliance();
    const trueMember = await makeMember(alliance.id, "True Member");
    const falseMember = await makeMember(alliance.id, "False Member");
    const legacyInvalidMember = await makeMember(alliance.id, "Legacy Invalid Member");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(
      alliance.id,
      "Attended Rally",
      Metric_Type.BOOLEAN,
      MetricSummaryKind.TRUE_RATE,
    );
    await attach(period.id, metric.id);

    await addEntry(trueMember.id, period.id, metric.id, 1, new Date("2026-03-01T10:00:00Z"));
    await addEntry(falseMember.id, period.id, metric.id, 0, new Date("2026-03-01T10:00:00Z"));
    // Simulates data written before the write-path 0/1 guard existed — bypasses the action layer entirely.
    await addEntry(legacyInvalidMember.id, period.id, metric.id, 2, new Date("2026-03-01T10:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    expect(report.rollup).toEqual({
      kind: "TRUE_RATE",
      trueCount: 1,
      falseCount: 1,
      invalidCount: 1,
      trueRate: 50,
    });
    expect(report.coverage.invalidActiveMemberCount).toBe(1);
    expect(report.coverage.complete).toBe(false);

    const invalidRow = report.rows.find((row) => row.allianceMemberId === legacyInvalidMember.id);
    expect(invalidRow?.booleanStatus).toBe("INVALID");
    expect(invalidRow?.rank).toBeNull();

    const trueRow = report.rows.find((row) => row.allianceMemberId === trueMember.id);
    expect(trueRow?.booleanStatus).toBe("TRUE");
    // TRUE_RATE never exposes ranking, even for the valid rows.
    expect(trueRow?.rank).toBeNull();
  });

  it("sorts a legacy invalid boolean value last under value_desc, never above valid TRUE/FALSE rows", async () => {
    const alliance = await makeAlliance();
    const trueMember = await makeMember(alliance.id, "True Member");
    const falseMember = await makeMember(alliance.id, "False Member");
    const legacyInvalidMember = await makeMember(alliance.id, "Legacy Invalid Member");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Attended Rally", Metric_Type.BOOLEAN, MetricSummaryKind.NONE);
    await attach(period.id, metric.id);

    await addEntry(trueMember.id, period.id, metric.id, 1, new Date("2026-03-01T10:00:00Z"));
    await addEntry(falseMember.id, period.id, metric.id, 0, new Date("2026-03-01T10:00:00Z"));
    // A raw value of 2 is numerically greater than 0/1, but must not outrank valid rows.
    await addEntry(legacyInvalidMember.id, period.id, metric.id, 2, new Date("2026-03-01T10:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      sort: "value_desc",
    });

    expect(report.rows.map((row) => row.allianceMemberId)).toEqual([
      trueMember.id,
      falseMember.id,
      legacyInvalidMember.id,
    ]);
  });

  it("paginates the roster server-side and clamps an out-of-range page to the last real page", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Kills", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    const members = await Promise.all(
      Array.from({ length: 12 }, (_, i) => makeMember(alliance.id, `Member ${String(i).padStart(2, "0")}`)),
    );
    await Promise.all(
      members.map((member, i) =>
        addEntry(member.id, period.id, metric.id, i, new Date(`2026-03-01T10:${String(i).padStart(2, "0")}:00Z`)),
      ),
    );

    const firstPage = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      pageSize: 10,
      page: 1,
    });
    expect(firstPage.pagination).toEqual({ page: 1, pageSize: 10, totalRowCount: 12 });
    expect(firstPage.rows).toHaveLength(10);

    const secondPage = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      pageSize: 10,
      page: 2,
    });
    expect(secondPage.rows).toHaveLength(2);

    const outOfRangePage = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      pageSize: 10,
      page: 999,
    });
    expect(outOfRangePage.pagination.page).toBe(2);
    expect(outOfRangePage.rows).toHaveLength(2);
  });

  it("filters the roster by player name search without changing the unfiltered rollup", async () => {
    const alliance = await makeAlliance();
    const alice = await makeMember(alliance.id, "Alice");
    const bob = await makeMember(alliance.id, "Bob");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Kills", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);
    await addEntry(alice.id, period.id, metric.id, 10, new Date("2026-03-01T10:00:00Z"));
    await addEntry(bob.id, period.id, metric.id, 20, new Date("2026-03-01T10:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
      search: "ali",
    });

    expect(report.rollup).toEqual({ kind: "SUM", total: 30, hasNegativeValues: false });
    expect(report.rows.map((row) => row.allianceMemberId)).toEqual([alice.id]);
    expect(report.pagination.totalRowCount).toBe(1);
  });

  it("computes an AVERAGE rollup and per-row differenceFromAverage", async () => {
    const alliance = await makeAlliance();
    const low = await makeMember(alliance.id, "Low");
    const high = await makeMember(alliance.id, "High");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(
      alliance.id,
      "Avg Power",
      Metric_Type.NUMERIC,
      MetricSummaryKind.AVERAGE,
    );
    await attach(period.id, metric.id);
    await addEntry(low.id, period.id, metric.id, 10, new Date("2026-03-01T10:00:00Z"));
    await addEntry(high.id, period.id, metric.id, 30, new Date("2026-03-01T10:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    expect(report.rollup).toEqual({ kind: "AVERAGE", average: 20 });
    const lowRow = report.rows.find((row) => row.allianceMemberId === low.id);
    const highRow = report.rows.find((row) => row.allianceMemberId === high.id);
    expect(lowRow?.differenceFromAverage).toBe(-10);
    expect(highRow?.differenceFromAverage).toBe(10);
  });

  it("excludes a comparison candidate with a different duration, even when it's otherwise the nearest eligible period", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const metric = await makeMetric(alliance.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);

    // Selected: a 2-week period.
    const selected = await makePeriod(alliance.id, "Week 3-4", {
      startsAt: new Date("2026-03-15T00:00:00Z"),
      endsAt: new Date("2026-03-28T00:00:00Z"),
    });
    await attach(selected.id, metric.id);
    await addEntry(member.id, selected.id, metric.id, 200, new Date("2026-03-20T00:00:00Z"));

    // Nearer but a different (1-week) duration -> must be excluded.
    const wrongDuration = await makePeriod(alliance.id, "Week 2 (short)", {
      startsAt: new Date("2026-03-08T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });
    await attach(wrongDuration.id, metric.id);
    await addEntry(member.id, wrongDuration.id, metric.id, 999, new Date("2026-03-10T00:00:00Z"));

    // Farther but a matching (2-week) duration -> the correct eligible comparison.
    const matchingDuration = await makePeriod(alliance.id, "Week 1-2", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });
    await attach(matchingDuration.id, metric.id);
    await addEntry(member.id, matchingDuration.id, metric.id, 100, new Date("2026-03-05T00:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: selected.id,
    });

    expect(report.comparison).toMatchObject({
      status: "COMPARED",
      period: { id: matchingDuration.id, name: "Week 1-2" },
      rollup: { kind: "SUM", total: 100 },
      absoluteChange: 100,
      percentageChange: 100,
    });
  });

  it("reports NO_DATA_IN_SELECTED_PERIOD (not a fabricated decline) when an active but empty selected period is compared against a populated prior period", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const metric = await makeMetric(alliance.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);

    // Selected: attached and active, but nobody has recorded a value yet.
    const selected = await makePeriod(alliance.id, "Week 2", {
      startsAt: new Date("2026-03-08T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });
    await attach(selected.id, metric.id);

    // Prior: same duration, ends before selected starts, and has real data.
    const prior = await makePeriod(alliance.id, "Week 1", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-07T00:00:00Z"),
    });
    await attach(prior.id, metric.id);
    await addEntry(member.id, prior.id, metric.id, 500, new Date("2026-03-05T00:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: selected.id,
    });

    expect(report.attachmentStatus).toBe("ACTIVE");
    expect(report.dataStatus).toBe("NO_VALUES");
    expect(report.rollup).toEqual({ kind: "SUM", total: 0, hasNegativeValues: false });
    // Must not fabricate a -100% "decline" against the prior period's real total.
    expect(report.comparison).toMatchObject({
      status: "NO_DATA_IN_SELECTED_PERIOD",
      period: { id: prior.id, name: "Week 1" },
    });
  });

  it("reports NO_DATA_IN_SELECTED_PERIOD when a NOT_ATTACHED selected period is compared against a populated prior period", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const metric = await makeMetric(alliance.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);

    // Selected: has dates (so duration/date eligibility can be evaluated),
    // but the metric was never attached to it at all.
    const selected = await makePeriod(alliance.id, "Week 2", {
      startsAt: new Date("2026-03-08T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });

    const prior = await makePeriod(alliance.id, "Week 1", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-07T00:00:00Z"),
    });
    await attach(prior.id, metric.id);
    await addEntry(member.id, prior.id, metric.id, 500, new Date("2026-03-05T00:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: selected.id,
    });

    expect(report.attachmentStatus).toBe("NOT_ATTACHED");
    expect(report.dataStatus).toBe("NO_VALUES");
    expect(report.comparison).toMatchObject({
      status: "NO_DATA_IN_SELECTED_PERIOD",
      period: { id: prior.id, name: "Week 1" },
    });
  });

  it("reports NOT_ATTACHED with no rows when the metric has never been configured for the period", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Unattached Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    // Intentionally no attach() call.

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    expect(report.attachmentStatus).toBe("NOT_ATTACHED");
    expect(report.dataStatus).toBe("NO_VALUES");
    expect(report.rollup).toEqual({ kind: "SUM", total: 0, hasNegativeValues: false });
  });

  it("shows historical values under INACTIVE when the attachment was later deactivated", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const period = await makePeriod(alliance.id, "Week 1");
    const metric = await makeMetric(alliance.id, "Deactivated Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id, false);
    await addEntry(member.id, period.id, metric.id, 42, new Date("2026-03-01T10:00:00Z"));

    const report = await getMetricSummaryReport({
      allianceId: alliance.id,
      metricId: metric.id,
      periodId: period.id,
    });

    expect(report.attachmentStatus).toBe("INACTIVE");
    expect(report.dataStatus).toBe("HAS_VALUES");
    expect(report.rollup).toEqual({ kind: "SUM", total: 42, hasNegativeValues: false });
  });

  it("throws a not-found error for a metric or period belonging to a different alliance", async () => {
    const allianceA = await makeAlliance();
    const allianceB = await makeAlliance();
    const period = await makePeriod(allianceA.id, "Week 1");
    const metric = await makeMetric(allianceA.id, "VS Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    await expect(
      getMetricSummaryReport({ allianceId: allianceB.id, metricId: metric.id, periodId: period.id }),
    ).rejects.toThrow();
  });

  describe("visualization (#264 PR4)", () => {
    it("includes every active member (missing shown as excluded from ranking) and only a contributing archived member, independent of the roster's own search/filter/sort/pagination", async () => {
      const alliance = await makeAlliance();
      const activeContributor = await makeMember(alliance.id, "Zeta Active");
      const activeMissing = await makeMember(alliance.id, "Yara Missing");
      const archivedContributor = await makeMember(alliance.id, "Xena Archived Contributor", true);
      const archivedNonContributor = await makeMember(alliance.id, "Wren Archived Silent", true);
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Donations", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id);

      await addEntry(activeContributor.id, period.id, metric.id, 100, new Date("2026-03-01T10:00:00Z"));
      await addEntry(archivedContributor.id, period.id, metric.id, 50, new Date("2026-03-01T10:00:00Z"));

      // A search that matches none of the visualization-relevant members —
      // the roster page/rows are empty, but the chart must be unaffected.
      const report = await getMetricSummaryReport({
        allianceId: alliance.id,
        metricId: metric.id,
        periodId: period.id,
        search: "nobody-matches-this",
      });

      expect(report.rows).toHaveLength(0);
      expect(report.pagination.totalRowCount).toBe(0);

      if (report.visualModel.kind !== "SUM") throw new Error("expected SUM");
      const contributorIds = report.visualModel.topContributors.map((c) => c.allianceMemberId).sort();
      expect(contributorIds).toEqual([activeContributor.id, archivedContributor.id].sort());
      expect(report.visualModel.consideredCount).toBe(2);
      // Total still reconciles across the whole cohort, matching the rollup.
      expect(report.rollup).toEqual({ kind: "SUM", total: 150, hasNegativeValues: false });
      // Neither the never-contributed active member nor the silent archived
      // member appear as a *named* contributor — active-missing legitimately
      // has no value to rank, and archived-non-contributing is excluded by
      // the same rule the roster's own "all" filter already uses.
      expect(contributorIds).not.toContain(activeMissing.id);
      expect(contributorIds).not.toContain(archivedNonContributor.id);
    });

    it("caps SUM's top contributors at 10 even with a larger active cohort, and computes each one's percentage of the real total", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Kills", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id);

      const members = await Promise.all(
        Array.from({ length: 15 }, (_, i) => makeMember(alliance.id, `Member ${String(i).padStart(2, "0")}`)),
      );
      await Promise.all(
        members.map((member, i) =>
          addEntry(member.id, period.id, metric.id, (i + 1) * 10, new Date(`2026-03-01T10:${String(i).padStart(2, "0")}:00Z`)),
        ),
      );

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      if (report.visualModel.kind !== "SUM") throw new Error("expected SUM");
      expect(report.visualModel.topContributors).toHaveLength(10);
      expect(report.visualModel.consideredCount).toBe(15);
      // Highest value (150) is member index 14 (i+1)*10 = 150.
      expect(report.visualModel.topContributors[0]).toMatchObject({ value: 150 });
      const total = members.length * 10 * (members.length + 1) / 2; // sum 10..150
      expect(report.rollup).toEqual({ kind: "SUM", total, hasNegativeValues: false });
      expect(report.visualModel.topContributors[0]!.percentageOfTotal).toBeCloseTo((150 / total) * 100);
    });

    it("marks SUM's chart-wide share unavailable when any valid value is negative, exactly matching the rollup's own hasNegativeValues", async () => {
      const alliance = await makeAlliance();
      const positive = await makeMember(alliance.id, "Positive");
      const negative = await makeMember(alliance.id, "Negative");
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Net Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id);
      await addEntry(positive.id, period.id, metric.id, 110, new Date("2026-03-01T10:00:00Z"));
      await addEntry(negative.id, period.id, metric.id, -10, new Date("2026-03-01T10:00:00Z"));

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      if (report.visualModel.kind !== "SUM") throw new Error("expected SUM");
      expect(report.visualModel.shareAvailability).toEqual({ available: false, reason: "NEGATIVE_VALUES_PRESENT" });
      expect(report.visualModel.topContributors.every((c) => c.percentageOfTotal === null)).toBe(true);
      expect(report.interpretationSummary).toBe(
        "Positive and negative contributions offset each other, so member shares are not meaningful.",
      );
    });

    it("builds an AVERAGE distribution across the real cohort, matching the rollup's own average", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Avg Power", Metric_Type.NUMERIC, MetricSummaryKind.AVERAGE);
      await attach(period.id, metric.id);

      const values = [0, 10, 20, 30, 40, 50];
      const members = await Promise.all(values.map((_, i) => makeMember(alliance.id, `Member ${i}`)));
      await Promise.all(
        members.map((member, i) =>
          addEntry(member.id, period.id, metric.id, values[i]!, new Date(`2026-03-01T10:${String(i).padStart(2, "0")}:00Z`)),
        ),
      );

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      expect(report.rollup).toEqual({ kind: "AVERAGE", average: 25 });
      if (report.visualModel.kind !== "AVERAGE") throw new Error("expected AVERAGE");
      expect(report.visualModel.average).toBe(25);
      expect(report.visualModel.validCount).toBe(6);
      expect(report.visualModel.bins.reduce((sum, b) => sum + b.count, 0)).toBe(6);
      expect(report.visualModel.aboveAverageCount).toBe(3);
      expect(report.visualModel.belowAverageCount).toBe(3);
    });

    it("collapses AVERAGE's distribution to a single bin when every recorded value is identical", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Flat Metric", Metric_Type.NUMERIC, MetricSummaryKind.AVERAGE);
      await attach(period.id, metric.id);

      const members = await Promise.all([makeMember(alliance.id, "A"), makeMember(alliance.id, "B"), makeMember(alliance.id, "C")]);
      await Promise.all(
        members.map((member, i) => addEntry(member.id, period.id, metric.id, 7, new Date(`2026-03-01T10:0${i}:00Z`))),
      );

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      if (report.visualModel.kind !== "AVERAGE") throw new Error("expected AVERAGE");
      expect(report.visualModel.bins).toEqual([{ rangeStart: 7, rangeEnd: 7, count: 3 }]);
      expect(report.visualModel.atAverageCount).toBe(3);
      expect(report.interpretationSummary).toBe("The average was 7 across 3 valid results.");
    });

    it("sources the TRUE_RATE visual model from the same aggregate as the rollup, including a legacy invalid value's contribution to coverage", async () => {
      const alliance = await makeAlliance();
      const trueMember = await makeMember(alliance.id, "True Member");
      const falseMember = await makeMember(alliance.id, "False Member");
      const legacyInvalidMember = await makeMember(alliance.id, "Legacy Invalid Member");
      const missingMember = await makeMember(alliance.id, "Missing Member");
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Attended Rally", Metric_Type.BOOLEAN, MetricSummaryKind.TRUE_RATE);
      await attach(period.id, metric.id);

      await addEntry(trueMember.id, period.id, metric.id, 1, new Date("2026-03-01T10:00:00Z"));
      await addEntry(falseMember.id, period.id, metric.id, 0, new Date("2026-03-01T10:00:00Z"));
      await addEntry(legacyInvalidMember.id, period.id, metric.id, 2, new Date("2026-03-01T10:00:00Z"));
      void missingMember; // never records — exercises missingActiveMemberCount

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      expect(report.visualModel).toEqual({
        kind: "TRUE_RATE",
        trueCount: 1,
        falseCount: 1,
        invalidCount: 1,
        recordedActiveMemberCount: 2,
        missingActiveMemberCount: 1,
        currentActiveMemberCount: 4,
      });
      expect(report.interpretationSummary).toBe(
        "1 of 2 valid responses were Yes; 1 member is missing and 1 value is invalid.",
      );
    });

    it("builds a numeric distribution (never a fabricated rollup) for a NONE-kind NUMERIC metric", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Notes Count", Metric_Type.NUMERIC, MetricSummaryKind.NONE);
      await attach(period.id, metric.id);

      const members = await Promise.all([makeMember(alliance.id, "A"), makeMember(alliance.id, "B")]);
      await addEntry(members[0]!.id, period.id, metric.id, 12, new Date("2026-03-01T10:00:00Z"));
      await addEntry(members[1]!.id, period.id, metric.id, 18, new Date("2026-03-01T10:01:00Z"));

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      expect(report.rollup).toEqual({ kind: "NONE" });
      if (report.visualModel.kind !== "NONE" || report.visualModel.valueKind !== "NUMERIC") {
        throw new Error("expected NONE/NUMERIC");
      }
      expect(report.visualModel.validCount).toBe(2);
      expect(report.visualModel.bins.reduce((sum, b) => sum + b.count, 0)).toBe(2);
      // Lowercased: it's fact2, joined after a semicolon, per the one-sentence contract.
      expect(report.interpretationSummary).toContain("no alliance-wide rollup is defined for this metric.");
    });

    it("preserves inactivity without denying retained history: an INACTIVE attachment's interpretation summary still reads the real total, with an inactivity caveat", async () => {
      const alliance = await makeAlliance();
      const member = await makeMember(alliance.id, "Alice");
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Deactivated Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id, false);
      await addEntry(member.id, period.id, metric.id, 42, new Date("2026-03-01T10:00:00Z"));

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      expect(report.attachmentStatus).toBe("INACTIVE");
      expect(report.dataStatus).toBe("HAS_VALUES");
      expect(report.rollup).toEqual({ kind: "SUM", total: 42, hasNegativeValues: false });
      expect(report.interpretationSummary).toBe(
        "Deactivated Metric totaled 42; the attachment is now inactive, so this reflects historical data only.",
      );
    });

    it("carries an archived top contributor's status through to the visual model, so PR5's chart can badge them", async () => {
      const alliance = await makeAlliance();
      const activeContributor = await makeMember(alliance.id, "Active Contributor");
      const archivedContributor = await makeMember(alliance.id, "Archived Contributor", true);
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Donations", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id);
      await addEntry(activeContributor.id, period.id, metric.id, 100, new Date("2026-03-01T10:00:00Z"));
      await addEntry(archivedContributor.id, period.id, metric.id, 50, new Date("2026-03-01T10:00:00Z"));

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      if (report.visualModel.kind !== "SUM") throw new Error("expected SUM");
      expect(report.visualModel.topContributors.find((c) => c.allianceMemberId === activeContributor.id)?.archived).toBe(
        false,
      );
      expect(
        report.visualModel.topContributors.find((c) => c.allianceMemberId === archivedContributor.id)?.archived,
      ).toBe(true);
    });

    it("guarantees a negative contributor survives SUM's top-10 cap even with 10+ positive contributors, and describes the cohort as mixed-sign (not all-negative)", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Net Score", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id);

      const positiveMembers = await Promise.all(
        Array.from({ length: 11 }, (_, i) => makeMember(alliance.id, `Positive ${String(i).padStart(2, "0")}`)),
      );
      const negativeMember = await makeMember(alliance.id, "Sole Negative");
      await Promise.all(
        positiveMembers.map((member, i) =>
          addEntry(member.id, period.id, metric.id, (i + 1) * 10, new Date(`2026-03-01T10:${String(i).padStart(2, "0")}:00Z`)),
        ),
      );
      await addEntry(negativeMember.id, period.id, metric.id, -5, new Date("2026-03-01T10:11:00Z"));

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      if (report.visualModel.kind !== "SUM") throw new Error("expected SUM");
      expect(report.visualModel.topContributors).toHaveLength(10);
      expect(report.visualModel.topContributors.some((c) => c.allianceMemberId === negativeMember.id)).toBe(true);
      expect(report.interpretationSummary).toBe(
        "Positive and negative contributions offset each other, so member shares are not meaningful.",
      );
    });

    it("distinguishes an all-negative SUM cohort from a genuinely mixed-sign one in the interpretation summary", async () => {
      const alliance = await makeAlliance();
      const memberA = await makeMember(alliance.id, "Member A");
      const memberB = await makeMember(alliance.id, "Member B");
      const period = await makePeriod(alliance.id, "Week 1");
      const metric = await makeMetric(alliance.id, "Losses", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
      await attach(period.id, metric.id);
      await addEntry(memberA.id, period.id, metric.id, -100, new Date("2026-03-01T10:00:00Z"));
      await addEntry(memberB.id, period.id, metric.id, -200, new Date("2026-03-01T10:01:00Z"));

      const report = await getMetricSummaryReport({ allianceId: alliance.id, metricId: metric.id, periodId: period.id });

      expect(report.rollup).toEqual({ kind: "SUM", total: -300, hasNegativeValues: true });
      expect(report.interpretationSummary).toBe(
        "Losses had no positive contributions this period, so no member share is meaningful.",
      );
    });
  });
});
