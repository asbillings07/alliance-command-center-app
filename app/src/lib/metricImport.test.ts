import { describe, it, expect } from "vitest";
import { buildMetricImportPlan, type MetricMapping } from "./metricImport";

describe("buildMetricImportPlan", () => {
  it("builds a plan across multiple metrics and totals the rows", () => {
    const mappings: MetricMapping[] = [
      {
        metricId: "kill-points",
        entries: [
          { memberId: "m1", value: 100 },
          { memberId: "m2", value: 200 },
        ],
      },
      {
        metricId: "vs-score",
        entries: [{ memberId: "m1", value: 5 }],
      },
    ];

    const plan = buildMetricImportPlan(mappings);

    expect(plan.totalCount).toBe(3);
    expect(plan.metricIds).toEqual(["kill-points", "vs-score"]);
    // Same member across different metrics is preserved.
    expect(plan.memberIds.sort()).toEqual(["m1", "m2"]);
  });

  it("keeps only the first row per member within a metric", () => {
    const plan = buildMetricImportPlan([
      {
        metricId: "kill-points",
        entries: [
          { memberId: "m1", value: 100 },
          { memberId: "m1", value: 999 },
          { memberId: "m2", value: 200 },
        ],
      },
    ]);

    expect(plan.mappings[0].entries).toEqual([
      { memberId: "m1", value: 100 },
      { memberId: "m2", value: 200 },
    ]);
    expect(plan.totalCount).toBe(2);
  });

  it("rejects an empty mapping list", () => {
    expect(() => buildMetricImportPlan([])).toThrow(
      /at least one metric mapping/i,
    );
  });

  it("rejects the same metric mapped twice", () => {
    const mappings: MetricMapping[] = [
      { metricId: "kill-points", entries: [{ memberId: "m1", value: 1 }] },
      { metricId: "kill-points", entries: [{ memberId: "m2", value: 2 }] },
    ];
    expect(() => buildMetricImportPlan(mappings)).toThrow(
      /only be mapped once/i,
    );
  });

  it("rejects a mapping with no entries", () => {
    expect(() =>
      buildMetricImportPlan([{ metricId: "kill-points", entries: [] }]),
    ).toThrow(/at least one entry/i);
  });

  it("rejects non-integer values", () => {
    expect(() =>
      buildMetricImportPlan([
        { metricId: "kill-points", entries: [{ memberId: "m1", value: 1.5 }] },
      ]),
    ).toThrow(/must be integers/i);
  });

  it("rejects a missing metric id", () => {
    expect(() =>
      buildMetricImportPlan([
        { metricId: "", entries: [{ memberId: "m1", value: 1 }] },
      ]),
    ).toThrow(/invalid metric id/i);
  });

  it("rejects a missing member id", () => {
    expect(() =>
      buildMetricImportPlan([
        { metricId: "kill-points", entries: [{ memberId: "", value: 1 }] },
      ]),
    ).toThrow(/invalid member id/i);
  });
});
