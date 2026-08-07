import { describe, expect, it } from "vitest";
import {
  computeComparablePeriodStats,
  computeMetricStabilityStats,
  type AuditPeriodAttachmentSnapshot,
} from "./apsAuditPeriodAnalysis";

describe("computeComparablePeriodStats", () => {
  it("counts periods missing dates separately from dated ones", () => {
    const stats = computeComparablePeriodStats([
      { id: "p1", startsAt: null, endsAt: null },
      { id: "p2", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") },
    ]);
    expect(stats.periodCount).toBe(2);
    expect(stats.periodsWithBothDatesCount).toBe(1);
    expect(stats.comparablePairCount).toBe(0);
    // 2026-01-01 to 2026-01-08 is a 7-day period.
    expect(stats.durationBucketCounts).toEqual({
      LTE_7_DAYS: 1,
      D8_TO_14_DAYS: 0,
      D15_TO_31_DAYS: 0,
      D32_PLUS_DAYS: 0,
    });
  });

  it("buckets period durations coarsely rather than reporting exact lengths", () => {
    const stats = computeComparablePeriodStats([
      { id: "weekly", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") }, // 7 days
      { id: "biweekly", startsAt: new Date("2026-02-01"), endsAt: new Date("2026-02-11") }, // 10 days
      { id: "monthly", startsAt: new Date("2026-03-01"), endsAt: new Date("2026-03-25") }, // 24 days
      { id: "long", startsAt: new Date("2026-04-01"), endsAt: new Date("2026-05-10") }, // 39 days
    ]);
    expect(stats.durationBucketCounts).toEqual({
      LTE_7_DAYS: 1,
      D8_TO_14_DAYS: 1,
      D15_TO_31_DAYS: 1,
      D32_PLUS_DAYS: 1,
    });
  });

  it("counts a comparable pair: same duration, non-overlapping", () => {
    const stats = computeComparablePeriodStats([
      { id: "p1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") },
      { id: "p2", startsAt: new Date("2026-01-09"), endsAt: new Date("2026-01-16") },
    ]);
    expect(stats.comparablePairCount).toBe(1);
  });

  it("does not count overlapping periods, even with equal duration", () => {
    const stats = computeComparablePeriodStats([
      { id: "p1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-10") },
      { id: "p2", startsAt: new Date("2026-01-05"), endsAt: new Date("2026-01-14") },
    ]);
    expect(stats.comparablePairCount).toBe(0);
  });

  it("does not count differing-duration periods, even when non-overlapping", () => {
    const stats = computeComparablePeriodStats([
      { id: "p1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") },
      { id: "p2", startsAt: new Date("2026-02-01"), endsAt: new Date("2026-02-20") },
    ]);
    expect(stats.comparablePairCount).toBe(0);
  });

  it("counts every qualifying pair across more than two periods", () => {
    const weekly = (start: string, end: string) => ({ id: `${start}`, startsAt: new Date(start), endsAt: new Date(end) });
    const stats = computeComparablePeriodStats([
      weekly("2026-01-01", "2026-01-08"),
      weekly("2026-01-09", "2026-01-16"),
      weekly("2026-01-17", "2026-01-24"),
    ]);
    expect(stats.comparablePairCount).toBe(3);
  });
});

describe("computeMetricStabilityStats", () => {
  function snapshot(
    periodId: string,
    startsAt: string,
    endsAt: string,
    components: Record<string, number>,
  ): AuditPeriodAttachmentSnapshot {
    return {
      periodId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      activeComponents: new Map(Object.entries(components)),
    };
  }

  it("reports zero changes for a single period (nothing to compare)", () => {
    const stats = computeMetricStabilityStats([snapshot("p1", "2026-01-01", "2026-01-08", { m1: 10 })]);
    expect(stats).toEqual({
      consecutivePeriodPairCount: 0,
      metricsAddedCount: 0,
      metricsRemovedCount: 0,
      weightChangedCount: 0,
    });
  });

  it("detects an added metric between consecutive periods", () => {
    const stats = computeMetricStabilityStats([
      snapshot("p1", "2026-01-01", "2026-01-08", { m1: 10 }),
      snapshot("p2", "2026-01-09", "2026-01-16", { m1: 10, m2: 5 }),
    ]);
    expect(stats.metricsAddedCount).toBe(1);
    expect(stats.metricsRemovedCount).toBe(0);
  });

  it("detects a removed metric between consecutive periods", () => {
    const stats = computeMetricStabilityStats([
      snapshot("p1", "2026-01-01", "2026-01-08", { m1: 10, m2: 5 }),
      snapshot("p2", "2026-01-09", "2026-01-16", { m1: 10 }),
    ]);
    expect(stats.metricsRemovedCount).toBe(1);
  });

  it("detects a weight change for a metric present in both periods", () => {
    const stats = computeMetricStabilityStats([
      snapshot("p1", "2026-01-01", "2026-01-08", { m1: 10 }),
      snapshot("p2", "2026-01-09", "2026-01-16", { m1: 20 }),
    ]);
    expect(stats.weightChangedCount).toBe(1);
    expect(stats.metricsAddedCount).toBe(0);
    expect(stats.metricsRemovedCount).toBe(0);
  });

  it("orders by startsAt regardless of input array order", () => {
    const stats = computeMetricStabilityStats([
      snapshot("p2", "2026-01-09", "2026-01-16", { m1: 20 }),
      snapshot("p1", "2026-01-01", "2026-01-08", { m1: 10 }),
    ]);
    expect(stats.weightChangedCount).toBe(1);
  });

  it("accumulates across every consecutive pair, not just the first", () => {
    const stats = computeMetricStabilityStats([
      snapshot("p1", "2026-01-01", "2026-01-08", { m1: 10 }),
      snapshot("p2", "2026-01-09", "2026-01-16", { m1: 10, m2: 5 }),
      snapshot("p3", "2026-01-17", "2026-01-24", { m2: 5, m3: 1 }),
    ]);
    expect(stats.consecutivePeriodPairCount).toBe(2);
    // p1->p2: m2 added. p2->p3: m1 removed, m3 added.
    expect(stats.metricsAddedCount).toBe(2);
    expect(stats.metricsRemovedCount).toBe(1);
  });
});
