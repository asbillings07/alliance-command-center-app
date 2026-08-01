import { describe, it, expect } from "vitest";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import {
  buildMetricRollup,
  buildMetricReportRow,
  computeBooleanRowStatus,
  computeDifferenceFromAverage,
  computeRollupChange,
  computeShareAvailability,
  normalizeSort,
  normalizeFilter,
  clampPageSize,
  clampRequestedPage,
  resolvePageAgainstTotal,
  boundSearchInput,
  escapeIlikePattern,
  buildSearchPattern,
  METRIC_REPORT_PAGE_SIZE_DEFAULT,
  METRIC_REPORT_PAGE_SIZE_MIN,
  METRIC_REPORT_PAGE_SIZE_MAX,
  METRIC_REPORT_SEARCH_MAX_LENGTH,
  type AggregateSnapshot,
  type MetricRollup,
} from "./getMetricSummaryReport";

function aggregate(overrides: Partial<AggregateSnapshot> = {}): AggregateSnapshot {
  return {
    sumValue: 0,
    averageValue: null,
    trueCount: 0,
    falseCount: 0,
    invalidCount: 0,
    hasNegativeValues: false,
    currentActiveMemberCount: 0,
    recordedActiveMemberCount: 0,
    invalidActiveMemberCount: 0,
    missingActiveMemberCount: 0,
    archivedContributingMemberCount: 0,
    latestEntryCount: 0,
    ...overrides,
  };
}

describe("buildMetricRollup", () => {
  it("SUM returns total and hasNegativeValues from the aggregate", () => {
    const rollup = buildMetricRollup(
      MetricSummaryKind.SUM,
      aggregate({ sumValue: 1500, hasNegativeValues: true }),
    );
    expect(rollup).toEqual({ kind: "SUM", total: 1500, hasNegativeValues: true });
  });

  it("AVERAGE returns null average when nothing was recorded", () => {
    const rollup = buildMetricRollup(MetricSummaryKind.AVERAGE, aggregate({ averageValue: null }));
    expect(rollup).toEqual({ kind: "AVERAGE", average: null });
  });

  it("AVERAGE passes through a computed average", () => {
    const rollup = buildMetricRollup(MetricSummaryKind.AVERAGE, aggregate({ averageValue: 42.5 }));
    expect(rollup).toEqual({ kind: "AVERAGE", average: 42.5 });
  });

  it("TRUE_RATE computes trueRate from valid counts only", () => {
    const rollup = buildMetricRollup(
      MetricSummaryKind.TRUE_RATE,
      aggregate({ trueCount: 3, falseCount: 1, invalidCount: 2 }),
    );
    expect(rollup).toEqual({ kind: "TRUE_RATE", trueCount: 3, falseCount: 1, invalidCount: 2, trueRate: 75 });
  });

  it("TRUE_RATE returns null trueRate when there are no valid entries", () => {
    const rollup = buildMetricRollup(
      MetricSummaryKind.TRUE_RATE,
      aggregate({ trueCount: 0, falseCount: 0, invalidCount: 4 }),
    );
    expect(rollup).toEqual({ kind: "TRUE_RATE", trueCount: 0, falseCount: 0, invalidCount: 4, trueRate: null });
  });

  it("NONE returns just the kind", () => {
    expect(buildMetricRollup(MetricSummaryKind.NONE, aggregate())).toEqual({ kind: "NONE" });
  });
});

describe("computeShareAvailability", () => {
  it("is unavailable (non-positive total) when the total is exactly zero", () => {
    const rollup: MetricRollup = { kind: "SUM", total: 0, hasNegativeValues: false };
    expect(computeShareAvailability(0, rollup)).toEqual({ available: false, reason: "NON_POSITIVE_TOTAL" });
  });

  it("is unavailable (non-positive total) when the total is negative", () => {
    const rollup: MetricRollup = { kind: "SUM", total: -10, hasNegativeValues: true };
    expect(computeShareAvailability(-10, rollup)).toEqual({
      available: false,
      reason: "NEGATIVE_VALUES_PRESENT",
    });
  });

  it("is unavailable (negative values present) for a mixed-sign cohort even with a positive total", () => {
    // Member A: -10, Member B: 110, total: 100 — mathematically a 110% "share" is misleading.
    const rollup: MetricRollup = { kind: "SUM", total: 100, hasNegativeValues: true };
    expect(computeShareAvailability(110, rollup)).toEqual({
      available: false,
      reason: "NEGATIVE_VALUES_PRESENT",
    });
  });

  it("computes percentageOfTotal when the total is positive and no negative values exist", () => {
    const rollup: MetricRollup = { kind: "SUM", total: 200, hasNegativeValues: false };
    expect(computeShareAvailability(50, rollup)).toEqual({ available: true, percentageOfTotal: 25 });
  });

  it("returns null for a non-SUM rollup", () => {
    expect(computeShareAvailability(50, { kind: "AVERAGE", average: 10 })).toBeNull();
    expect(computeShareAvailability(50, { kind: "NONE" })).toBeNull();
  });
});

describe("computeDifferenceFromAverage", () => {
  it("returns the signed difference for an AVERAGE rollup", () => {
    expect(computeDifferenceFromAverage(30, { kind: "AVERAGE", average: 20 })).toBe(10);
    expect(computeDifferenceFromAverage(10, { kind: "AVERAGE", average: 20 })).toBe(-10);
  });

  it("returns null when the average itself is null", () => {
    expect(computeDifferenceFromAverage(30, { kind: "AVERAGE", average: null })).toBeNull();
  });

  it("returns null for a non-AVERAGE rollup", () => {
    expect(computeDifferenceFromAverage(30, { kind: "SUM", total: 100, hasNegativeValues: false })).toBeNull();
  });
});

describe("computeBooleanRowStatus", () => {
  it("classifies null as MISSING", () => {
    expect(computeBooleanRowStatus(null)).toBe("MISSING");
  });

  it("classifies 1 as TRUE and 0 as FALSE", () => {
    expect(computeBooleanRowStatus(1)).toBe("TRUE");
    expect(computeBooleanRowStatus(0)).toBe("FALSE");
  });

  it("classifies any other integer as INVALID (legacy pre-guard data)", () => {
    expect(computeBooleanRowStatus(2)).toBe("INVALID");
    expect(computeBooleanRowStatus(-1)).toBe("INVALID");
    expect(computeBooleanRowStatus(42)).toBe("INVALID");
  });
});

describe("buildMetricReportRow", () => {
  it("attaches share for SUM rows with a value, and leaves it null when missing", () => {
    const rollup: MetricRollup = { kind: "SUM", total: 100, hasNegativeValues: false };
    const withValue = buildMetricReportRow({
      allianceMemberId: "m1",
      playerName: "Alice",
      archived: false,
      value: 25,
      rank: 1,
      metricType: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.SUM,
      rollup,
    });
    expect(withValue.share).toEqual({ available: true, percentageOfTotal: 25 });
    expect(withValue.differenceFromAverage).toBeNull();
    expect(withValue.booleanStatus).toBeNull();

    const missing = buildMetricReportRow({
      allianceMemberId: "m2",
      playerName: "Bob",
      archived: false,
      value: null,
      rank: null,
      metricType: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.SUM,
      rollup,
    });
    expect(missing.share).toBeNull();
  });

  it("attaches differenceFromAverage only for AVERAGE-kind rows with a value", () => {
    const rollup: MetricRollup = { kind: "AVERAGE", average: 10 };
    const row = buildMetricReportRow({
      allianceMemberId: "m1",
      playerName: "Alice",
      archived: false,
      value: 15,
      rank: 1,
      metricType: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.AVERAGE,
      rollup,
    });
    expect(row.differenceFromAverage).toBe(5);
    expect(row.share).toBeNull();
  });

  it("never exposes a rank for TRUE_RATE rows, even when the SQL computed one", () => {
    const rollup: MetricRollup = { kind: "TRUE_RATE", trueCount: 1, falseCount: 1, invalidCount: 0, trueRate: 50 };
    const row = buildMetricReportRow({
      allianceMemberId: "m1",
      playerName: "Alice",
      archived: false,
      value: 1,
      rank: 1,
      metricType: Metric_Type.BOOLEAN,
      summaryKind: MetricSummaryKind.TRUE_RATE,
      rollup,
    });
    expect(row.rank).toBeNull();
    expect(row.booleanStatus).toBe("TRUE");
  });

  it("still ranks a NONE-kind BOOLEAN metric's valid values", () => {
    const rollup: MetricRollup = { kind: "NONE" };
    const row = buildMetricReportRow({
      allianceMemberId: "m1",
      playerName: "Alice",
      archived: false,
      value: 1,
      rank: 2,
      metricType: Metric_Type.BOOLEAN,
      summaryKind: MetricSummaryKind.NONE,
      rollup,
    });
    expect(row.rank).toBe(2);
    expect(row.booleanStatus).toBe("TRUE");
  });

  it("only computes booleanStatus for BOOLEAN-type metrics", () => {
    const rollup: MetricRollup = { kind: "SUM", total: 100, hasNegativeValues: false };
    const row = buildMetricReportRow({
      allianceMemberId: "m1",
      playerName: "Alice",
      archived: false,
      value: 5,
      rank: 1,
      metricType: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.SUM,
      rollup,
    });
    expect(row.booleanStatus).toBeNull();
  });
});

describe("computeRollupChange", () => {
  it("SUM: computes absolute and percentage change against a positive comparison total", () => {
    const selected: MetricRollup = { kind: "SUM", total: 150, hasNegativeValues: false };
    const comparison: MetricRollup = { kind: "SUM", total: 100, hasNegativeValues: false };
    expect(computeRollupChange(MetricSummaryKind.SUM, selected, comparison)).toEqual({
      absoluteChange: 50,
      percentageChange: 50,
    });
  });

  it("SUM: percentage change is unavailable (not Infinity/0%) when the comparison total is zero", () => {
    const selected: MetricRollup = { kind: "SUM", total: 50, hasNegativeValues: false };
    const comparison: MetricRollup = { kind: "SUM", total: 0, hasNegativeValues: false };
    const result = computeRollupChange(MetricSummaryKind.SUM, selected, comparison);
    expect(result.absoluteChange).toBe(50);
    expect(result.percentageChange).toBeNull();
  });

  it("AVERAGE: computes absolute and percentage change", () => {
    const selected: MetricRollup = { kind: "AVERAGE", average: 30 };
    const comparison: MetricRollup = { kind: "AVERAGE", average: 20 };
    expect(computeRollupChange(MetricSummaryKind.AVERAGE, selected, comparison)).toEqual({
      absoluteChange: 10,
      percentageChange: 50,
    });
  });

  it("AVERAGE: returns nulls when either average is null", () => {
    const selected: MetricRollup = { kind: "AVERAGE", average: null };
    const comparison: MetricRollup = { kind: "AVERAGE", average: 20 };
    expect(computeRollupChange(MetricSummaryKind.AVERAGE, selected, comparison)).toEqual({
      absoluteChange: null,
      percentageChange: null,
    });
  });

  it("TRUE_RATE: expresses change as a percentage-point difference, never a percentageChange", () => {
    const selected: MetricRollup = { kind: "TRUE_RATE", trueCount: 8, falseCount: 2, invalidCount: 0, trueRate: 80 };
    const comparison: MetricRollup = {
      kind: "TRUE_RATE",
      trueCount: 5,
      falseCount: 5,
      invalidCount: 0,
      trueRate: 50,
    };
    expect(computeRollupChange(MetricSummaryKind.TRUE_RATE, selected, comparison)).toEqual({
      absoluteChange: 30,
      percentageChange: null,
    });
  });

  it("TRUE_RATE: returns nulls when either rate is null", () => {
    const selected: MetricRollup = { kind: "TRUE_RATE", trueCount: 0, falseCount: 0, invalidCount: 0, trueRate: null };
    const comparison: MetricRollup = {
      kind: "TRUE_RATE",
      trueCount: 5,
      falseCount: 5,
      invalidCount: 0,
      trueRate: 50,
    };
    expect(computeRollupChange(MetricSummaryKind.TRUE_RATE, selected, comparison)).toEqual({
      absoluteChange: null,
      percentageChange: null,
    });
  });
});

describe("normalizeSort", () => {
  it("passes through known values", () => {
    expect(normalizeSort("value_asc")).toBe("value_asc");
    expect(normalizeSort("name_asc")).toBe("name_asc");
    expect(normalizeSort("value_desc")).toBe("value_desc");
  });

  it("defaults to value_desc for missing or garbage input", () => {
    expect(normalizeSort(undefined)).toBe("value_desc");
    expect(normalizeSort(null)).toBe("value_desc");
    expect(normalizeSort("not-a-sort")).toBe("value_desc");
  });
});

describe("normalizeFilter", () => {
  it("passes through known values", () => {
    expect(normalizeFilter("archived")).toBe("archived");
    expect(normalizeFilter("all")).toBe("all");
    expect(normalizeFilter("active")).toBe("active");
  });

  it("defaults to active for missing or garbage input", () => {
    expect(normalizeFilter(undefined)).toBe("active");
    expect(normalizeFilter(null)).toBe("active");
    expect(normalizeFilter("not-a-filter")).toBe("active");
  });
});

describe("clampPageSize", () => {
  it("defaults when missing/non-finite", () => {
    expect(clampPageSize(undefined)).toBe(METRIC_REPORT_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(null)).toBe(METRIC_REPORT_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(NaN)).toBe(METRIC_REPORT_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(Infinity)).toBe(METRIC_REPORT_PAGE_SIZE_DEFAULT);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampPageSize(0)).toBe(METRIC_REPORT_PAGE_SIZE_MIN);
    expect(clampPageSize(-5)).toBe(METRIC_REPORT_PAGE_SIZE_MIN);
    expect(clampPageSize(1000)).toBe(METRIC_REPORT_PAGE_SIZE_MAX);
  });

  it("floors fractional values within range", () => {
    expect(clampPageSize(25.9)).toBe(25);
  });
});

describe("clampRequestedPage", () => {
  it("defaults to 1 for missing/invalid input", () => {
    expect(clampRequestedPage(undefined)).toBe(1);
    expect(clampRequestedPage(null)).toBe(1);
    expect(clampRequestedPage(0)).toBe(1);
    expect(clampRequestedPage(-3)).toBe(1);
    expect(clampRequestedPage(NaN)).toBe(1);
  });

  it("floors a valid page number", () => {
    expect(clampRequestedPage(3.7)).toBe(3);
  });
});

describe("resolvePageAgainstTotal", () => {
  it("returns the requested page when it is within range", () => {
    expect(resolvePageAgainstTotal(2, 100, 25)).toBe(2);
  });

  it("clamps an out-of-range page down to the last real page, never returning zero rows", () => {
    expect(resolvePageAgainstTotal(99, 55, 25)).toBe(3);
  });

  it("always returns at least page 1 when there are zero total rows", () => {
    expect(resolvePageAgainstTotal(5, 0, 25)).toBe(1);
  });
});

describe("boundSearchInput", () => {
  it("returns an empty string for missing input", () => {
    expect(boundSearchInput(undefined)).toBe("");
    expect(boundSearchInput(null)).toBe("");
    expect(boundSearchInput("")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(boundSearchInput("  Alice  ")).toBe("Alice");
  });

  it("truncates rather than rejecting overly long input", () => {
    const long = "a".repeat(METRIC_REPORT_SEARCH_MAX_LENGTH + 50);
    expect(boundSearchInput(long)).toHaveLength(METRIC_REPORT_SEARCH_MAX_LENGTH);
  });
});

describe("escapeIlikePattern", () => {
  it("escapes %, _, and backslash", () => {
    expect(escapeIlikePattern("100%_off\\")).toBe("100\\%\\_off\\\\");
  });
});

describe("buildSearchPattern", () => {
  it("returns an empty string sentinel for no search term", () => {
    expect(buildSearchPattern(undefined)).toBe("");
    expect(buildSearchPattern("   ")).toBe("");
  });

  it("wraps an escaped, bounded term in wildcards", () => {
    expect(buildSearchPattern("Ali_ce")).toBe("%Ali\\_ce%");
  });
});
