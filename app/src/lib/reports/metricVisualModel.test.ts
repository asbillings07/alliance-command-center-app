import { describe, it, expect } from "vitest";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import type { AggregateSnapshot } from "@/app/src/lib/reports/metricRollup";
import {
  buildDistributionBins,
  buildMetricVisualModel,
  DISTRIBUTION_BIN_COUNT,
  type VisualCohortRow,
} from "@/app/src/lib/reports/metricVisualModel";

function row(overrides: Partial<VisualCohortRow> = {}): VisualCohortRow {
  return {
    allianceMemberId: "mem_1",
    playerName: "Alice",
    archived: false,
    value: 10,
    ...overrides,
  };
}

function zeroAggregate(overrides: Partial<AggregateSnapshot> = {}): AggregateSnapshot {
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

describe("buildDistributionBins", () => {
  it("returns no bins for an empty value set", () => {
    expect(buildDistributionBins([])).toEqual([]);
  });

  it("returns exactly one bin spanning the single repeated value when every value is equal", () => {
    expect(buildDistributionBins([7, 7, 7])).toEqual([{ rangeStart: 7, rangeEnd: 7, count: 3 }]);
  });

  it("also collapses to one bin for a single distinct value even with just one entry", () => {
    expect(buildDistributionBins([42])).toEqual([{ rangeStart: 42, rangeEnd: 42, count: 1 }]);
  });

  it("builds DISTRIBUTION_BIN_COUNT equal-width bins spanning [min, max] otherwise", () => {
    const bins = buildDistributionBins([0, 10, 20, 30, 40, 50, 60]);
    expect(bins).toHaveLength(DISTRIBUTION_BIN_COUNT);
    expect(bins[0]!.rangeStart).toBe(0);
    expect(bins[bins.length - 1]!.rangeEnd).toBe(60);
    // width = 60/6 = 10, so bin edges land exactly on 0,10,20,...,60
    expect(bins.map((b) => b.rangeStart)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(bins.map((b) => b.rangeEnd)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("puts every value in exactly one bin, and the maximum value always lands in the last bin", () => {
    const bins = buildDistributionBins([0, 100]);
    const totalCount = bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(2);
    expect(bins[bins.length - 1]!.count).toBeGreaterThanOrEqual(1);
  });

  it("assigns a value exactly on an interior bin boundary to the upper bin (half-open [start, end) except the last bin)", () => {
    // width = 100/6 ≈ 16.667; value 16.666... just under the first boundary falls in bin 0,
    // and the boundary value itself (~16.667) falls in bin 1.
    const bins = buildDistributionBins([0, 100 / 6, 100]);
    expect(bins[0]!.count).toBe(1); // the 0
    expect(bins[bins.length - 1]!.count).toBe(1); // the 100
    const middleBinTotal = bins.slice(1, -1).reduce((sum, b) => sum + b.count, 0);
    expect(middleBinTotal).toBe(1); // the boundary value, landing in the bin *starting* there
  });
});

describe("buildMetricVisualModel — SUM", () => {
  function build(rows: VisualCohortRow[], aggregate: AggregateSnapshot) {
    return buildMetricVisualModel({
      summaryKind: MetricSummaryKind.SUM,
      metricType: Metric_Type.NUMERIC,
      rows,
      aggregate,
    });
  }

  it("ranks contributors desc by value and computes each one's percentage of the total when share is available", () => {
    const rows = [
      row({ allianceMemberId: "m1", playerName: "Alice", value: 300 }),
      row({ allianceMemberId: "m2", playerName: "Bob", value: 700 }),
    ];
    const model = build(rows, zeroAggregate({ sumValue: 1000 }));

    expect(model).toMatchObject({ kind: "SUM", consideredCount: 2 });
    if (model.kind !== "SUM") throw new Error("expected SUM");
    expect(model.shareAvailability).toEqual({ available: true, percentageOfTotal: 100 });
    expect(model.topContributors).toEqual([
      { allianceMemberId: "m2", playerName: "Bob", archived: false, value: 700, percentageOfTotal: 70 },
      { allianceMemberId: "m1", playerName: "Alice", archived: false, value: 300, percentageOfTotal: 30 },
    ]);
  });

  it("carries a contributor's archived status through to the visual model, so PR5's chart can badge an archived top contributor", () => {
    const rows = [
      row({ allianceMemberId: "m1", playerName: "Alice", archived: true, value: 300 }),
      row({ allianceMemberId: "m2", playerName: "Bob", archived: false, value: 700 }),
    ];
    const model = build(rows, zeroAggregate({ sumValue: 1000 }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors.find((c) => c.allianceMemberId === "m1")?.archived).toBe(true);
    expect(model.topContributors.find((c) => c.allianceMemberId === "m2")?.archived).toBe(false);
  });

  it("caps top contributors at 10 even with a larger cohort, while consideredCount reflects everyone with a value", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({ allianceMemberId: `m${i}`, playerName: `Player ${i}`, value: 15 - i }),
    );
    const model = build(rows, zeroAggregate({ sumValue: rows.reduce((s, r) => s + (r.value ?? 0), 0) }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toHaveLength(10);
    expect(model.consideredCount).toBe(15);
    expect(model.topContributors[0]!.value).toBe(15);
    expect(model.topContributors[9]!.value).toBe(6);
  });

  it("breaks value ties by playerName ascending, then allianceMemberId ascending", () => {
    const rows = [
      row({ allianceMemberId: "z9", playerName: "Zoe", value: 50 }),
      row({ allianceMemberId: "a1", playerName: "Zoe", value: 50 }),
      row({ allianceMemberId: "b1", playerName: "Amy", value: 50 }),
    ];
    const model = build(rows, zeroAggregate({ sumValue: 150 }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors.map((c) => c.allianceMemberId)).toEqual(["b1", "a1", "z9"]);
  });

  it("excludes members with no recorded value entirely from ranking and from consideredCount", () => {
    const rows = [row({ allianceMemberId: "m1", value: 100 }), row({ allianceMemberId: "m2", value: null })];
    const model = build(rows, zeroAggregate({ sumValue: 100 }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.consideredCount).toBe(1);
    expect(model.topContributors).toHaveLength(1);
  });

  it("marks share unavailable (NEGATIVE_VALUES_PRESENT) and nulls every bar's percentage when any valid value is negative", () => {
    const rows = [row({ allianceMemberId: "m1", value: 150 }), row({ allianceMemberId: "m2", value: -50 })];
    const model = build(rows, zeroAggregate({ sumValue: 100, hasNegativeValues: true }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.shareAvailability).toEqual({ available: false, reason: "NEGATIVE_VALUES_PRESENT" });
    expect(model.topContributors.every((c) => c.percentageOfTotal === null)).toBe(true);
    // Raw values are still preserved for a diverging-bar rendering, even though share is unavailable.
    expect(model.topContributors.map((c) => c.value).sort((a, b) => a - b)).toEqual([-50, 150]);
  });

  it("retains the strongest (most negative) contributor over several weaker ones nearest zero when the negative side is itself capped", () => {
    // 3 positives (all fit easily) plus 8 negatives ranging from -1 to
    // -1000. Only 7 of the 8 negative slots are available, so the weakest
    // (closest-to-zero) negative, -1, must be dropped — never the
    // materially larger -1000, which is exactly the contributor a
    // diverging chart most needs to surface.
    const positiveRows = [
      row({ allianceMemberId: "pos1", playerName: "Positive 1", value: 10 }),
      row({ allianceMemberId: "pos2", playerName: "Positive 2", value: 8 }),
      row({ allianceMemberId: "pos3", playerName: "Positive 3", value: 6 }),
    ];
    const negativeRows = [
      row({ allianceMemberId: "neg_1000", playerName: "Neg 1000", value: -1000 }),
      row({ allianceMemberId: "neg_7", playerName: "Neg 7", value: -7 }),
      row({ allianceMemberId: "neg_6", playerName: "Neg 6", value: -6 }),
      row({ allianceMemberId: "neg_5", playerName: "Neg 5", value: -5 }),
      row({ allianceMemberId: "neg_4", playerName: "Neg 4", value: -4 }),
      row({ allianceMemberId: "neg_3", playerName: "Neg 3", value: -3 }),
      row({ allianceMemberId: "neg_2", playerName: "Neg 2", value: -2 }),
      row({ allianceMemberId: "neg_1", playerName: "Neg 1", value: -1 }),
    ];
    const rows = [...positiveRows, ...negativeRows];
    const model = build(rows, zeroAggregate({ sumValue: -1004, hasNegativeValues: true }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toHaveLength(10);
    expect(model.topContributors.some((c) => c.allianceMemberId === "neg_1000")).toBe(true);
    expect(model.topContributors.some((c) => c.allianceMemberId === "neg_1")).toBe(false);
  });

  it("breaks a tie exactly at the negative-selection cutoff by playerName ascending — matching sortedByValueDesc's own tie-break, never a reversed order", () => {
    // 5 positives consume the full positive half (5 of 10 slots), leaving
    // exactly 5 negative slots. 6 negatives compete for those 5 slots:
    // -100, -90, -80, -70 clearly qualify, and two members tied at -60
    // (the weakest of the six) compete for the single remaining slot.
    // Only a *stable* ascending-value sort (not a reversal of the whole
    // desc-sorted array) preserves sortedByValueDesc's own ascending
    // playerName tie-break for that pair, correctly selecting "Amy" over
    // "Zoe" — a `.reverse()`-based implementation would silently flip
    // this and select "Zoe" instead.
    const positiveRows = Array.from({ length: 5 }, (_, i) =>
      row({ allianceMemberId: `pos${i}`, playerName: `Positive ${i}`, value: (i + 1) * 10 }),
    );
    const negativeRows = [
      row({ allianceMemberId: "amy60", playerName: "Amy", value: -60 }),
      row({ allianceMemberId: "zoe60", playerName: "Zoe", value: -60 }),
      row({ allianceMemberId: "n70", playerName: "N70", value: -70 }),
      row({ allianceMemberId: "n80", playerName: "N80", value: -80 }),
      row({ allianceMemberId: "n90", playerName: "N90", value: -90 }),
      row({ allianceMemberId: "n100", playerName: "N100", value: -100 }),
    ];
    const rows = [...positiveRows, ...negativeRows];
    const model = build(rows, zeroAggregate({ sumValue: -260, hasNegativeValues: true }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toHaveLength(10);
    expect(model.topContributors.some((c) => c.allianceMemberId === "amy60")).toBe(true);
    expect(model.topContributors.some((c) => c.allianceMemberId === "zoe60")).toBe(false);
  });

  it("guarantees at least one negative contributor survives the cap when 10+ positive values would otherwise fill every slot", () => {
    // 12 positive values (100..1200) plus a single negative value (-5). A
    // plain top-10-by-value slice would drop the only negative entirely,
    // even though the chart is explicitly in diverging mode.
    const positiveRows = Array.from({ length: 12 }, (_, i) =>
      row({ allianceMemberId: `pos${i}`, playerName: `Positive ${i}`, value: (i + 1) * 100 }),
    );
    const rows = [...positiveRows, row({ allianceMemberId: "neg1", playerName: "Negative", value: -5 })];
    const model = build(rows, zeroAggregate({ sumValue: 7795, hasNegativeValues: true }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toHaveLength(10);
    expect(model.topContributors.some((c) => c.allianceMemberId === "neg1")).toBe(true);
    expect(model.consideredCount).toBe(13);
  });

  it("keeps a plain top-10-by-value cap (no forced negative slot) when every value is non-negative", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ allianceMemberId: `m${i}`, playerName: `Player ${i}`, value: (i + 1) * 10 }),
    );
    const model = build(rows, zeroAggregate({ sumValue: 780, hasNegativeValues: false }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toHaveLength(10);
    // Highest 10 of 12 values: 30..120 in steps of 10, desc.
    expect(model.topContributors.map((c) => c.value)).toEqual([120, 110, 100, 90, 80, 70, 60, 50, 40, 30]);
  });

  it("fills every slot from the larger side when one sign has fewer than half the available slots (backfill), keeping the strongest (most negative) values — never the weakest ones nearest zero", () => {
    // Only 2 positive values, 20 negative values, negative total, so
    // hasNegativeValues is true. The 2 positives must both survive (there's
    // room), and the remaining 8 slots backfill with the *most negative*
    // (largest-magnitude) values, matching the same "most extreme"
    // selection principle used for the positive side — not the values
    // closest to zero, which would hide the largest detractors entirely.
    const positiveRows = [
      row({ allianceMemberId: "pos1", playerName: "Positive 1", value: 5 }),
      row({ allianceMemberId: "pos2", playerName: "Positive 2", value: 3 }),
    ];
    const negativeRows = Array.from({ length: 20 }, (_, i) =>
      row({ allianceMemberId: `neg${i}`, playerName: `Negative ${i}`, value: -(i + 1) }),
    );
    const rows = [...positiveRows, ...negativeRows];
    const model = build(rows, zeroAggregate({ sumValue: -202, hasNegativeValues: true }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toHaveLength(10);
    expect(model.topContributors.some((c) => c.allianceMemberId === "pos1")).toBe(true);
    expect(model.topContributors.some((c) => c.allianceMemberId === "pos2")).toBe(true);
    // 8 negative backfill slots -> the 8 strongest (most negative): -13..-20.
    const negativeValues = model.topContributors.map((c) => c.value).filter((v) => v < 0);
    expect(negativeValues.sort((a, b) => a - b)).toEqual([-20, -19, -18, -17, -16, -15, -14, -13]);
  });

  it("marks share unavailable (NON_POSITIVE_TOTAL) when the total is zero or negative without any individual negative value", () => {
    const rows = [row({ allianceMemberId: "m1", value: 0 })];
    const model = build(rows, zeroAggregate({ sumValue: 0, hasNegativeValues: false }));
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.shareAvailability).toEqual({ available: false, reason: "NON_POSITIVE_TOTAL" });
  });

  it("handles a fully empty cohort (no one has recorded a value) without throwing", () => {
    const model = build([row({ value: null })], zeroAggregate());
    if (model.kind !== "SUM") throw new Error("expected SUM");

    expect(model.topContributors).toEqual([]);
    expect(model.consideredCount).toBe(0);
    expect(model.shareAvailability.available).toBe(false);
  });
});

describe("buildMetricVisualModel — AVERAGE", () => {
  function build(rows: VisualCohortRow[], aggregate: AggregateSnapshot) {
    return buildMetricVisualModel({
      summaryKind: MetricSummaryKind.AVERAGE,
      metricType: Metric_Type.NUMERIC,
      rows,
      aggregate,
    });
  }

  it("reports a null average, no bins, and zero counts when there are no valid results", () => {
    const model = build([row({ value: null })], zeroAggregate({ averageValue: null }));
    if (model.kind !== "AVERAGE") throw new Error("expected AVERAGE");

    expect(model).toEqual({
      kind: "AVERAGE",
      average: null,
      bins: [],
      aboveAverageCount: 0,
      belowAverageCount: 0,
      atAverageCount: 0,
      validCount: 0,
    });
  });

  it("collapses to a single bin and puts every member exactly at the average when all valid values are equal", () => {
    const rows = [row({ allianceMemberId: "m1", value: 5 }), row({ allianceMemberId: "m2", value: 5 })];
    const model = build(rows, zeroAggregate({ averageValue: 5 }));
    if (model.kind !== "AVERAGE") throw new Error("expected AVERAGE");

    expect(model.bins).toEqual([{ rangeStart: 5, rangeEnd: 5, count: 2 }]);
    expect(model.atAverageCount).toBe(2);
    expect(model.aboveAverageCount).toBe(0);
    expect(model.belowAverageCount).toBe(0);
    expect(model.validCount).toBe(2);
  });

  it("splits members above/below/at the average and builds a multi-bin distribution for a normal spread", () => {
    const rows = [
      row({ allianceMemberId: "m1", value: 0 }),
      row({ allianceMemberId: "m2", value: 10 }),
      row({ allianceMemberId: "m3", value: 20 }),
    ];
    const model = build(rows, zeroAggregate({ averageValue: 10 }));
    if (model.kind !== "AVERAGE") throw new Error("expected AVERAGE");

    expect(model.aboveAverageCount).toBe(1);
    expect(model.belowAverageCount).toBe(1);
    expect(model.atAverageCount).toBe(1);
    expect(model.validCount).toBe(3);
    expect(model.bins).toHaveLength(DISTRIBUTION_BIN_COUNT);
  });

  it("excludes members with no recorded value from the distribution and above/below counts", () => {
    const rows = [row({ allianceMemberId: "m1", value: 10 }), row({ allianceMemberId: "m2", value: null })];
    const model = build(rows, zeroAggregate({ averageValue: 10 }));
    if (model.kind !== "AVERAGE") throw new Error("expected AVERAGE");

    expect(model.validCount).toBe(1);
    expect(model.atAverageCount).toBe(1);
  });
});

describe("buildMetricVisualModel — TRUE_RATE", () => {
  it("is sourced directly from the aggregate's counts, ignoring rows entirely", () => {
    const aggregate = zeroAggregate({
      trueCount: 14,
      falseCount: 4,
      invalidCount: 1,
      recordedActiveMemberCount: 18,
      missingActiveMemberCount: 2,
      currentActiveMemberCount: 20,
    });
    const model = buildMetricVisualModel({
      summaryKind: MetricSummaryKind.TRUE_RATE,
      metricType: Metric_Type.BOOLEAN,
      rows: [], // deliberately empty — must not matter for TRUE_RATE
      aggregate,
    });

    expect(model).toEqual({
      kind: "TRUE_RATE",
      trueCount: 14,
      falseCount: 4,
      invalidCount: 1,
      recordedActiveMemberCount: 18,
      missingActiveMemberCount: 2,
      currentActiveMemberCount: 20,
    });
  });
});

describe("buildMetricVisualModel — NONE", () => {
  it("mirrors TRUE_RATE's boolean-category shape (yes/no/invalid + coverage) for a BOOLEAN metric, without a rate framing", () => {
    const aggregate = zeroAggregate({
      trueCount: 5,
      falseCount: 3,
      invalidCount: 0,
      recordedActiveMemberCount: 8,
      missingActiveMemberCount: 1,
      currentActiveMemberCount: 9,
    });
    const model = buildMetricVisualModel({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.BOOLEAN,
      rows: [],
      aggregate,
    });

    expect(model).toEqual({
      kind: "NONE",
      valueKind: "BOOLEAN",
      trueCount: 5,
      falseCount: 3,
      invalidCount: 0,
      recordedActiveMemberCount: 8,
      missingActiveMemberCount: 1,
      currentActiveMemberCount: 9,
    });
  });

  it("builds a numeric distribution (never a rollup) for a NUMERIC metric", () => {
    const rows = [
      row({ allianceMemberId: "m1", value: 10 }),
      row({ allianceMemberId: "m2", value: 20 }),
      row({ allianceMemberId: "m3", value: null }),
    ];
    const model = buildMetricVisualModel({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rows,
      aggregate: zeroAggregate(),
    });

    if (model.kind !== "NONE" || model.valueKind !== "NUMERIC") throw new Error("expected NONE/NUMERIC");
    expect(model.validCount).toBe(2);
    expect(model.bins.reduce((sum, b) => sum + b.count, 0)).toBe(2);
    // Never carries any of SUM/AVERAGE/TRUE_RATE's rollup fields.
    expect(model).not.toHaveProperty("average");
    expect(model).not.toHaveProperty("trueCount");
  });

  it("returns an empty distribution for a NUMERIC metric with zero valid values", () => {
    const model = buildMetricVisualModel({
      summaryKind: MetricSummaryKind.NONE,
      metricType: Metric_Type.NUMERIC,
      rows: [row({ value: null })],
      aggregate: zeroAggregate(),
    });

    if (model.kind !== "NONE" || model.valueKind !== "NUMERIC") throw new Error("expected NONE/NUMERIC");
    expect(model.bins).toEqual([]);
    expect(model.validCount).toBe(0);
  });
});
