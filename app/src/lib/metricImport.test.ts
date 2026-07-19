import { describe, it, expect } from "vitest";
import {
  buildMetricImportPlan,
  validateColumnTargets,
  type MetricMapping,
  type ColumnTargetMapping,
} from "./metricImport";

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

describe("validateColumnTargets", () => {
  it("dedupes rows per member within a column and passes the target through", () => {
    const mappings: ColumnTargetMapping[] = [
      {
        target: { kind: "existing", metricId: "m-kp" },
        entries: [
          { memberId: "m1", value: 100 },
          { memberId: "m1", value: 999 },
          { memberId: "m2", value: 200 },
        ],
      },
    ];
    const [result] = validateColumnTargets(mappings);
    expect(result.target).toEqual({ kind: "existing", metricId: "m-kp" });
    expect(result.entries).toEqual([
      { memberId: "m1", value: 100 },
      { memberId: "m2", value: 200 },
    ]);
  });

  it("rejects the same existing metric mapped to two columns", () => {
    const mappings: ColumnTargetMapping[] = [
      { target: { kind: "existing", metricId: "m-kp" }, entries: [{ memberId: "m1", value: 1 }] },
      { target: { kind: "existing", metricId: "m-kp" }, entries: [{ memberId: "m2", value: 2 }] },
    ];
    expect(() => validateColumnTargets(mappings)).toThrow(/only be mapped once/i);
  });

  it("rejects two create targets with the same name ignoring case/space", () => {
    const mappings: ColumnTargetMapping[] = [
      { target: { kind: "create", name: "VS Score" }, entries: [{ memberId: "m1", value: 1 }] },
      { target: { kind: "create", name: "  vs   score " }, entries: [{ memberId: "m2", value: 2 }] },
    ];
    expect(() => validateColumnTargets(mappings)).toThrow(/new metric may only be mapped once/i);
  });

  it("rejects a create target with a blank name", () => {
    const mappings: ColumnTargetMapping[] = [
      { target: { kind: "create", name: "   " }, entries: [{ memberId: "m1", value: 1 }] },
    ];
    expect(() => validateColumnTargets(mappings)).toThrow(/requires a name/i);
  });

  it("rejects non-integer values", () => {
    const mappings: ColumnTargetMapping[] = [
      { target: { kind: "existing", metricId: "m-kp" }, entries: [{ memberId: "m1", value: 1.5 }] },
    ];
    expect(() => validateColumnTargets(mappings)).toThrow(/must be integers/i);
  });

  it("rejects an empty mapping list", () => {
    expect(() => validateColumnTargets([])).toThrow(/at least one column mapping/i);
  });
});
