import { describe, it, expect } from "vitest";
import {
  compareMetricPeriodsForCurrent,
  pickCurrentMetricPeriod,
  findPriorMetricPeriod,
  findOlderMetricPeriods,
} from "./metricPeriodOrdering";

function period(
  id: string,
  startsAt: Date | null,
  createdAt: Date,
) {
  return { id, startsAt, createdAt };
}

describe("metricPeriodOrdering", () => {
  it("prefers later startsAt over newer createdAt", () => {
    const current = period("current", new Date("2026-04-01"), new Date("2026-01-01"));
    const importedHistorical = period(
      "imported",
      new Date("2026-03-01"),
      new Date("2026-07-01"),
    );

    expect(pickCurrentMetricPeriod([importedHistorical, current])?.id).toBe("current");
  });

  it("sorts null startsAt after dated periods", () => {
    const dated = period("dated", new Date("2026-02-01"), new Date("2026-01-01"));
    const undated = period("undated", null, new Date("2026-12-01"));

    expect(pickCurrentMetricPeriod([undated, dated])?.id).toBe("dated");
  });

  it("uses createdAt then id when startsAt ties", () => {
    const sameStartOlderCreated = period(
      "older-created",
      new Date("2026-03-01"),
      new Date("2026-02-01"),
    );
    const sameStartNewerCreated = period(
      "newer-created",
      new Date("2026-03-01"),
      new Date("2026-03-15"),
    );

    expect(
      compareMetricPeriodsForCurrent(sameStartOlderCreated, sameStartNewerCreated),
    ).toBeGreaterThan(0);
    expect(pickCurrentMetricPeriod([sameStartOlderCreated, sameStartNewerCreated])?.id).toBe(
      "newer-created",
    );
  });
});

describe("findPriorMetricPeriod", () => {
  const oldest = period("oldest", new Date("2026-01-01"), new Date("2026-01-01"));
  const middle = period("middle", new Date("2026-02-01"), new Date("2026-01-01"));
  const newest = period("newest", new Date("2026-03-01"), new Date("2026-01-01"));

  it("returns the adjacent older period, not just any earlier one", () => {
    expect(findPriorMetricPeriod([oldest, middle, newest], "newest")?.id).toBe("middle");
    expect(findPriorMetricPeriod([oldest, middle, newest], "middle")?.id).toBe("oldest");
  });

  it("returns null for the oldest period in history - there is no prior period", () => {
    expect(findPriorMetricPeriod([oldest, middle, newest], "oldest")).toBeNull();
  });

  it("returns null for a single-period alliance", () => {
    expect(findPriorMetricPeriod([oldest], "oldest")).toBeNull();
  });

  it("returns null when the selected period id isn't in the list (defensive)", () => {
    expect(findPriorMetricPeriod([oldest, middle], "unknown")).toBeNull();
  });

  it("is order-independent - callers don't need to pre-sort", () => {
    expect(findPriorMetricPeriod([newest, oldest, middle], "newest")?.id).toBe("middle");
  });

  it("skips inactive/undated gaps correctly using the same null-startsAt-last rule as pickCurrentMetricPeriod", () => {
    const undated = period("undated", null, new Date("2026-06-01"));
    // undated sorts after every dated period (nulls last), so it's "oldest"
    // regardless of its createdAt - the prior period *of* undated is the
    // dated period right before it, and nothing is prior *to* undated.
    expect(findPriorMetricPeriod([oldest, middle, newest, undated], "undated")).toBeNull();
    expect(findPriorMetricPeriod([oldest, middle, newest, undated], "newest")?.id).toBe("middle");
  });
});

describe("findOlderMetricPeriods", () => {
  const oldest = period("oldest", new Date("2026-01-01"), new Date("2026-01-01"));
  const middle = period("middle", new Date("2026-02-01"), new Date("2026-01-01"));
  const newest = period("newest", new Date("2026-03-01"), new Date("2026-01-01"));

  it("returns every strictly-older period, nearest-first", () => {
    expect(findOlderMetricPeriods([oldest, middle, newest], "newest").map((p) => p.id)).toEqual([
      "middle",
      "oldest",
    ]);
    expect(findOlderMetricPeriods([oldest, middle, newest], "middle").map((p) => p.id)).toEqual([
      "oldest",
    ]);
  });

  it("returns [] for the oldest period in history - nothing is older", () => {
    expect(findOlderMetricPeriods([oldest, middle, newest], "oldest")).toEqual([]);
  });

  it("returns [] for a single-period alliance", () => {
    expect(findOlderMetricPeriods([oldest], "oldest")).toEqual([]);
  });

  it("returns [] when the selected period id isn't in the list (defensive)", () => {
    expect(findOlderMetricPeriods([oldest, middle], "unknown")).toEqual([]);
  });

  it("is order-independent - callers don't need to pre-sort", () => {
    expect(findOlderMetricPeriods([newest, oldest, middle], "newest").map((p) => p.id)).toEqual([
      "middle",
      "oldest",
    ]);
  });

  it("its first entry always matches findPriorMetricPeriod", () => {
    for (const id of ["oldest", "middle", "newest"]) {
      const older = findOlderMetricPeriods([oldest, middle, newest], id);
      const prior = findPriorMetricPeriod([oldest, middle, newest], id);
      expect(older[0] ?? null).toEqual(prior);
    }
  });
});
