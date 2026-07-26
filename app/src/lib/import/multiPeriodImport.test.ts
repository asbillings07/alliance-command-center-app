import { describe, it, expect } from "vitest";
import {
  validateMultiPeriodImportGroups,
  planMultiPeriodImportGroup,
  aggregateRequiredPermissions,
  type MultiPeriodImportGroupInput,
} from "./multiPeriodImport";
import { Permissions } from "@/app/src/lib/auth/permissions";

const libraryMetrics = [
  { id: "lib-kills", name: "Kills" },
  { id: "lib-power", name: "Hero Power" },
];

function group(
  targetPeriodId: string,
  mappings: MultiPeriodImportGroupInput["mappings"],
): MultiPeriodImportGroupInput {
  return { targetPeriodId, mappings };
}

describe("validateMultiPeriodImportGroups", () => {
  it("rejects empty group list", () => {
    expect(() => validateMultiPeriodImportGroups([])).toThrow(/at least one period group/i);
  });

  it("rejects duplicate target period ids across groups", () => {
    expect(() =>
      validateMultiPeriodImportGroups([
        group("period-a", [
          {
            sourceColumnName: "Kills on 3/29",
            target: { kind: "existing", metricId: "m1" },
            entries: [{ memberId: "mem1", rawValue: "10" }],
          },
        ]),
        group("period-a", [
          {
            sourceColumnName: "Kills on 4/13",
            target: { kind: "existing", metricId: "m2" },
            entries: [{ memberId: "mem1", rawValue: "20" }],
          },
        ]),
      ]),
    ).toThrow(/only appear once/i);
  });

  it("rejects groups with no mappings", () => {
    expect(() => validateMultiPeriodImportGroups([{ targetPeriodId: "p1", mappings: [] }])).toThrow(
      /at least one column mapping/i,
    );
  });
});

describe("planMultiPeriodImportGroup", () => {
  it("allows the same metric name in two different periods", () => {
    const mapping = [
      {
        sourceColumnName: "Kills on 3/29",
        target: { kind: "existing" as const, metricId: "kills-a" },
        entries: [{ memberId: "mem1", rawValue: "100" }],
      },
    ];

    const planA = planMultiPeriodImportGroup(group("period-a", mapping), {
      periodMetricIds: ["kills-a"],
      libraryMetrics,
    });
    const planB = planMultiPeriodImportGroup(group("period-b", mapping), {
      periodMetricIds: ["kills-b"],
      libraryMetrics: [{ id: "kills-b", name: "Kills" }, ...libraryMetrics],
    });

    expect(planA.validated).toHaveLength(1);
    expect(planB.validated).toHaveLength(1);
  });

  it("rejects duplicate metrics within one period group", () => {
    expect(() =>
      planMultiPeriodImportGroup(
        group("period-a", [
          {
            sourceColumnName: "Kills on 3/29",
            target: { kind: "existing", metricId: "kills-a" },
            entries: [{ memberId: "mem1", rawValue: "100" }],
          },
          {
            sourceColumnName: "Kills duplicate",
            target: { kind: "existing", metricId: "kills-a" },
            entries: [{ memberId: "mem2", rawValue: "200" }],
          },
        ]),
        { periodMetricIds: ["kills-a"], libraryMetrics },
      ),
    ).toThrow(/only be mapped once/i);
  });

  it("aggregates required permissions across groups", () => {
    const attachPlan = planMultiPeriodImportGroup(
      group("period-a", [
        {
          sourceColumnName: "Library Metric",
          target: { kind: "existing", metricId: "lib-kills" },
          entries: [{ memberId: "mem1", rawValue: "1" }],
        },
      ]),
      { periodMetricIds: [], libraryMetrics },
    );
    const createPlan = planMultiPeriodImportGroup(
      group("period-b", [
        {
          sourceColumnName: "New Metric",
          target: { kind: "create", name: "New Metric" },
          entries: [{ memberId: "mem1", rawValue: "2" }],
        },
      ]),
      { periodMetricIds: [], libraryMetrics },
    );

    const aggregated = aggregateRequiredPermissions([attachPlan, createPlan]);
    expect(aggregated).toContain(Permissions.IMPORT_METRICS);
    expect(aggregated).toContain(Permissions.CONFIGURE_PERIODS);
    expect(aggregated).toContain(Permissions.CONFIGURE_METRICS);
  });
});
