import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import { getAlliancePerformanceReport, AlliancePerformanceReportNotFoundError } from "./getAlliancePerformanceReport";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("getAlliancePerformanceReport [integration]", () => {
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

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Alliance Report Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function makeMember(allianceId: string, playerName: string, archived = false) {
    return prisma.allianceMember.create({
      data: { allianceId, playerName, archivedAt: archived ? new Date("2026-01-01") : null },
    });
  }

  async function makePeriod(allianceId: string, name: string, dates?: { startsAt: Date; endsAt: Date }) {
    return prisma.metricPeriod.create({ data: { allianceId, name, startsAt: dates?.startsAt, endsAt: dates?.endsAt } });
  }

  async function makeMetric(
    allianceId: string,
    name: string,
    type: Metric_Type,
    summaryKind: MetricSummaryKind,
    active = true,
  ) {
    return prisma.metric.create({ data: { allianceId, name, type, summaryKind, active } });
  }

  async function attach(periodId: string, metricId: string, active = true) {
    return prisma.metricPeriodMetric.create({ data: { periodId, metricId, weight: 1, required: false, active } });
  }

  async function addEntry(allianceMemberId: string, periodId: string, metricId: string, value: number, at: Date) {
    return prisma.memberMetricEntry.create({
      data: { allianceMemberId, periodId, metricId, value, recordedAt: at, createdAt: at },
    });
  }

  it("throws AlliancePerformanceReportNotFoundError for a period belonging to another alliance", async () => {
    const alliance = await makeAlliance();
    const other = await makeAlliance();
    const otherPeriod = await makePeriod(other.id, "Other Week");

    await expect(
      getAlliancePerformanceReport({ allianceId: alliance.id, periodId: otherPeriod.id }),
    ).rejects.toThrow(AlliancePerformanceReportNotFoundError);
  });

  it("builds the deterministic metric universe: active metrics always included, archived metrics only when related to this period", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const unrelatedPeriod = await makePeriod(alliance.id, "Week 0");

    const activeUnattached = await makeMetric(alliance.id, "Active Unattached", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    const activeAttached = await makeMetric(alliance.id, "Active Attached", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, activeAttached.id);

    const archivedAttachedThisPeriod = await makeMetric(
      alliance.id,
      "Archived Attached This Period",
      Metric_Type.NUMERIC,
      MetricSummaryKind.SUM,
      false,
    );
    await attach(period.id, archivedAttachedThisPeriod.id, false);

    const archivedUnrelated = await makeMetric(
      alliance.id,
      "Archived Unrelated",
      Metric_Type.NUMERIC,
      MetricSummaryKind.SUM,
      false,
    );
    await attach(unrelatedPeriod.id, archivedUnrelated.id);

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: period.id });
    const ids = report.metrics.map((m) => m.metric.id);

    expect(ids).toContain(activeUnattached.id);
    expect(ids).toContain(activeAttached.id);
    expect(ids).toContain(archivedAttachedThisPeriod.id);
    expect(ids).not.toContain(archivedUnrelated.id);
  });

  it("orders metrics active-first, then by name, then by id — stable regardless of attachment/data state", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");

    const zebra = await makeMetric(alliance.id, "Zebra", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    const apple = await makeMetric(alliance.id, "Apple", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    const archived = await makeMetric(alliance.id, "Aardvark Archived", Metric_Type.NUMERIC, MetricSummaryKind.SUM, false);
    await attach(period.id, archived.id);

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: period.id });
    const names = report.metrics.map((m) => m.metric.name);

    expect(names).toEqual(["Apple", "Zebra", "Aardvark Archived"]);
    void zebra;
    void apple;
  });

  it("computes isolated, correct bulk aggregates and attachment/data status for SUM, AVERAGE, TRUE_RATE, and NONE metrics in one period", async () => {
    const alliance = await makeAlliance();
    const active1 = await makeMember(alliance.id, "Active One");
    const active2 = await makeMember(alliance.id, "Active Two");
    const archived = await makeMember(alliance.id, "Archived Contributor", true);
    const period = await makePeriod(alliance.id, "Week 1");

    const sumMetric = await makeMetric(alliance.id, "Donations", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, sumMetric.id);
    await addEntry(active1.id, period.id, sumMetric.id, 100, new Date("2026-03-01T10:00:00Z"));
    await addEntry(archived.id, period.id, sumMetric.id, 25, new Date("2026-03-01T10:00:00Z"));

    const avgMetric = await makeMetric(alliance.id, "Response Time", Metric_Type.NUMERIC, MetricSummaryKind.AVERAGE);
    await attach(period.id, avgMetric.id);
    await addEntry(active1.id, period.id, avgMetric.id, 10, new Date("2026-03-01T10:00:00Z"));
    await addEntry(active2.id, period.id, avgMetric.id, 20, new Date("2026-03-01T10:00:00Z"));

    const rateMetric = await makeMetric(alliance.id, "Showed Up", Metric_Type.BOOLEAN, MetricSummaryKind.TRUE_RATE);
    await attach(period.id, rateMetric.id);
    await addEntry(active1.id, period.id, rateMetric.id, 1, new Date("2026-03-01T10:00:00Z"));
    await addEntry(active2.id, period.id, rateMetric.id, 0, new Date("2026-03-01T10:00:00Z"));

    const noneMetric = await makeMetric(alliance.id, "Notes", Metric_Type.NUMERIC, MetricSummaryKind.NONE);
    await attach(period.id, noneMetric.id);
    // Deliberately no entries: unattached-with-data isn't the point of this case.

    const unattachedMetric = await makeMetric(alliance.id, "Never Attached", Metric_Type.NUMERIC, MetricSummaryKind.SUM);

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: period.id });
    const byId = new Map(report.metrics.map((m) => [m.metric.id, m]));

    const sum = byId.get(sumMetric.id)!;
    expect(sum.rollup).toEqual({ kind: "SUM", total: 125, hasNegativeValues: false });
    expect(sum.attachmentStatus).toBe("ACTIVE");
    expect(sum.dataStatus).toBe("HAS_VALUES");
    expect(sum.coverage).toMatchObject({
      currentActiveMemberCount: 2,
      recordedActiveMemberCount: 1,
      missingActiveMemberCount: 1,
      archivedContributingMemberCount: 1,
    });

    const avg = byId.get(avgMetric.id)!;
    expect(avg.rollup).toEqual({ kind: "AVERAGE", average: 15 });
    expect(avg.coverage).toMatchObject({ currentActiveMemberCount: 2, recordedActiveMemberCount: 2, missingActiveMemberCount: 0 });

    const rate = byId.get(rateMetric.id)!;
    expect(rate.rollup).toEqual({ kind: "TRUE_RATE", trueCount: 1, falseCount: 1, invalidCount: 0, trueRate: 50 });

    const none = byId.get(noneMetric.id)!;
    expect(none.rollup).toEqual({ kind: "NONE" });
    expect(none.attachmentStatus).toBe("ACTIVE");
    expect(none.dataStatus).toBe("NO_VALUES");

    const unattached = byId.get(unattachedMetric.id)!;
    expect(unattached.attachmentStatus).toBe("NOT_ATTACHED");
    expect(unattached.dataStatus).toBe("NO_VALUES");
    expect(unattached.rollup).toEqual({ kind: "SUM", total: 0, hasNegativeValues: false });
    expect(unattached.coverage.currentActiveMemberCount).toBe(2);
    expect(unattached.coverage.missingActiveMemberCount).toBe(2);
  });

  it("resolves one shared comparison period for the alliance and reports each metric's own honest status against it", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");

    const priorPeriod = await makePeriod(alliance.id, "Week 1", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-07T00:00:00Z"),
    });
    const selectedPeriod = await makePeriod(alliance.id, "Week 2", {
      startsAt: new Date("2026-03-08T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });

    // Attached to and has data in both periods: expect COMPARED.
    const compared = await makeMetric(alliance.id, "Compared Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(priorPeriod.id, compared.id);
    await attach(selectedPeriod.id, compared.id);
    await addEntry(member.id, priorPeriod.id, compared.id, 50, new Date("2026-03-02T00:00:00Z"));
    await addEntry(member.id, selectedPeriod.id, compared.id, 80, new Date("2026-03-09T00:00:00Z"));

    // Attached to the selected period only: expect NOT_ATTACHED against the comparison period.
    const notAttachedInComparison = await makeMetric(
      alliance.id,
      "Not Attached In Comparison",
      Metric_Type.NUMERIC,
      MetricSummaryKind.SUM,
    );
    await attach(selectedPeriod.id, notAttachedInComparison.id);
    await addEntry(member.id, selectedPeriod.id, notAttachedInComparison.id, 10, new Date("2026-03-09T00:00:00Z"));

    // Attached to the comparison period but inactive there.
    const inactiveInComparison = await makeMetric(
      alliance.id,
      "Inactive In Comparison",
      Metric_Type.NUMERIC,
      MetricSummaryKind.SUM,
    );
    await attach(priorPeriod.id, inactiveInComparison.id, false);
    await attach(selectedPeriod.id, inactiveInComparison.id);
    await addEntry(member.id, selectedPeriod.id, inactiveInComparison.id, 10, new Date("2026-03-09T00:00:00Z"));

    // Attached and active in the comparison period, but nothing recorded there.
    const noDataInComparison = await makeMetric(
      alliance.id,
      "No Data In Comparison",
      Metric_Type.NUMERIC,
      MetricSummaryKind.SUM,
    );
    await attach(priorPeriod.id, noDataInComparison.id);
    await attach(selectedPeriod.id, noDataInComparison.id);
    await addEntry(member.id, selectedPeriod.id, noDataInComparison.id, 10, new Date("2026-03-09T00:00:00Z"));

    // NONE-kind: always NO_ROLLUP, never a comparison.
    const noneMetric = await makeMetric(alliance.id, "None Kind", Metric_Type.NUMERIC, MetricSummaryKind.NONE);
    await attach(priorPeriod.id, noneMetric.id);
    await attach(selectedPeriod.id, noneMetric.id);
    await addEntry(member.id, selectedPeriod.id, noneMetric.id, 10, new Date("2026-03-09T00:00:00Z"));

    const report = await getAlliancePerformanceReport({
      allianceId: alliance.id,
      periodId: selectedPeriod.id,
      comparePeriodId: priorPeriod.id,
    });

    expect(report.comparisonSelection).toMatchObject({ status: "RESOLVED", period: { id: priorPeriod.id } });

    const byId = new Map(report.metrics.map((m) => [m.metric.id, m]));

    expect(byId.get(compared.id)!.comparison).toEqual({
      status: "COMPARED",
      rollup: { kind: "SUM", total: 50, hasNegativeValues: false },
      absoluteChange: 30,
      percentageChange: 60,
    });
    expect(byId.get(notAttachedInComparison.id)!.comparison).toEqual({ status: "NOT_ATTACHED" });
    expect(byId.get(inactiveInComparison.id)!.comparison).toEqual({ status: "INACTIVE_ATTACHMENT" });
    expect(byId.get(noDataInComparison.id)!.comparison).toEqual({ status: "NO_DATA_IN_COMPARISON_PERIOD" });
    expect(byId.get(noneMetric.id)!.comparison).toEqual({ status: "NO_ROLLUP" });
  });

  it("reports NO_DATA_IN_SELECTED_PERIOD when the selected period itself has no values, even if the comparison period does", async () => {
    const alliance = await makeAlliance();
    const member = await makeMember(alliance.id, "Alice");
    const priorPeriod = await makePeriod(alliance.id, "Week 1", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-07T00:00:00Z"),
    });
    const selectedPeriod = await makePeriod(alliance.id, "Week 2", {
      startsAt: new Date("2026-03-08T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });

    const metric = await makeMetric(alliance.id, "Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(priorPeriod.id, metric.id);
    await attach(selectedPeriod.id, metric.id);
    await addEntry(member.id, priorPeriod.id, metric.id, 50, new Date("2026-03-02T00:00:00Z"));

    const report = await getAlliancePerformanceReport({
      allianceId: alliance.id,
      periodId: selectedPeriod.id,
      comparePeriodId: priorPeriod.id,
    });

    const found = report.metrics.find((m) => m.metric.id === metric.id)!;
    expect(found.comparison).toEqual({ status: "NO_DATA_IN_SELECTED_PERIOD" });
  });

  it("returns NO_ELIGIBLE_PERIOD when no earlier structurally-comparable period exists, and no comparison is computed for any metric", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-07T00:00:00Z"),
    });
    const metric = await makeMetric(alliance.id, "Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, metric.id);

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: period.id });

    expect(report.comparisonSelection).toEqual({ status: "NO_ELIGIBLE_PERIOD" });
    expect(report.metrics.every((m) => m.comparison === null)).toBe(true);
  });

  it("picks the alliance-wide comparison default independent of any single metric's attachment history", async () => {
    // The comparison candidate has no attachment at all for either metric — under the
    // per-metric resolver this would be ineligible; the alliance-wide resolver only
    // checks structural (date/duration) comparability, so it must still be picked.
    const alliance = await makeAlliance();
    const candidate = await makePeriod(alliance.id, "Week 1", {
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-03-07T00:00:00Z"),
    });
    const selected = await makePeriod(alliance.id, "Week 2", {
      startsAt: new Date("2026-03-08T00:00:00Z"),
      endsAt: new Date("2026-03-14T00:00:00Z"),
    });
    const metric = await makeMetric(alliance.id, "Metric", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(selected.id, metric.id);

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: selected.id });

    expect(report.comparisonSelection).toMatchObject({ status: "RESOLVED", period: { id: candidate.id } });
  });

  it("computes overall coverage only across active attachments, excluding not-attached and inactive metrics", async () => {
    const alliance = await makeAlliance();
    const active1 = await makeMember(alliance.id, "Active One");
    const active2 = await makeMember(alliance.id, "Active Two");
    const period = await makePeriod(alliance.id, "Week 1");

    const attachedComplete = await makeMetric(alliance.id, "Complete", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, attachedComplete.id);
    await addEntry(active1.id, period.id, attachedComplete.id, 10, new Date("2026-03-01T10:00:00Z"));
    await addEntry(active2.id, period.id, attachedComplete.id, 20, new Date("2026-03-01T10:00:00Z"));

    const attachedPartial = await makeMetric(alliance.id, "Partial", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, attachedPartial.id);
    await addEntry(active1.id, period.id, attachedPartial.id, 10, new Date("2026-03-01T10:00:00Z"));

    const notAttached = await makeMetric(alliance.id, "Not Attached", Metric_Type.NUMERIC, MetricSummaryKind.SUM);

    const inactive = await makeMetric(alliance.id, "Inactive", Metric_Type.NUMERIC, MetricSummaryKind.SUM);
    await attach(period.id, inactive.id, false);

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: period.id });

    expect(report.overallCoverage).toEqual({
      activeAttachmentCount: 2,
      notAttachedCount: 1,
      inactiveAttachmentCount: 1,
      expectedCells: 4, // 2 active members x 2 active-attachment metrics
      validCells: 3, // 2 (complete) + 1 (partial)
      coveragePercent: 75,
    });
    void notAttached;
  });

  it("excludes an invalid legacy boolean value from validCells while still counting it in expectedCells", async () => {
    const alliance = await makeAlliance();
    const active1 = await makeMember(alliance.id, "Active One");
    const active2 = await makeMember(alliance.id, "Active Two");
    const period = await makePeriod(alliance.id, "Week 1");

    const rate = await makeMetric(alliance.id, "Rate", Metric_Type.BOOLEAN, MetricSummaryKind.TRUE_RATE);
    await attach(period.id, rate.id);
    await addEntry(active1.id, period.id, rate.id, 1, new Date("2026-03-01T10:00:00Z"));
    // A legacy invalid boolean value (neither 0 nor 1) — active1's submission
    // does not vanish from `expectedCells`, but must never count as "valid".
    await addEntry(active2.id, period.id, rate.id, 5, new Date("2026-03-01T10:00:00Z"));

    const report = await getAlliancePerformanceReport({ allianceId: alliance.id, periodId: period.id });

    expect(report.overallCoverage).toEqual({
      activeAttachmentCount: 1,
      notAttachedCount: 0,
      inactiveAttachmentCount: 0,
      expectedCells: 2,
      validCells: 1,
      coveragePercent: 50,
    });
  });
});
