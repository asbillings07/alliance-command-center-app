import { describe, it, expect } from "vitest";
import {
  validateMultiPeriodImportGroups,
  planMultiPeriodImportGroup,
  aggregateRequiredPermissions,
  type MultiPeriodImportGroupInput,
  type MultiPeriodGroupTarget,
} from "./multiPeriodImport";
import { Permissions } from "@/app/src/lib/auth/permissions";

const libraryMetrics = [
  { id: "lib-kills", name: "Kills" },
  { id: "lib-power", name: "Hero Power" },
];

function group(
  target: MultiPeriodGroupTarget,
  mappings: MultiPeriodImportGroupInput["mappings"],
): MultiPeriodImportGroupInput {
  return { target, mappings };
}

describe("validateMultiPeriodImportGroups", () => {
  it("rejects empty group list", () => {
    expect(() => validateMultiPeriodImportGroups([])).toThrow(/at least one period group/i);
  });

  it("rejects duplicate existing target period ids across groups", () => {
    expect(() =>
      validateMultiPeriodImportGroups([
        group(
          { kind: "existing", periodId: "period-a" },
          [
            {
              sourceColumnName: "Kills on 3/29",
              target: { kind: "existing", metricId: "m1" },
              entries: [{ memberId: "mem1", rawValue: "10" }],
            },
          ],
        ),
        group(
          { kind: "existing", periodId: "period-a" },
          [
            {
              sourceColumnName: "Kills on 4/13",
              target: { kind: "existing", metricId: "m2" },
              entries: [{ memberId: "mem1", rawValue: "20" }],
            },
          ],
        ),
      ]),
    ).toThrow(/only appear once/i);
  });

  it("rejects duplicate create period names within one submission", () => {
    expect(() =>
      validateMultiPeriodImportGroups([
        group(
          {
            kind: "create",
            name: "March 2026",
            startsAt: "2026-03-01",
            endsAt: "2026-03-31",
          },
          [
            {
              sourceColumnName: "Kills on 3/29",
              target: { kind: "create", name: "Kills" },
              entries: [{ memberId: "mem1", rawValue: "10" }],
            },
          ],
        ),
        group(
          {
            kind: "create",
            name: "  march 2026 ",
            startsAt: "2026-03-01",
            endsAt: null,
          },
          [
            {
              sourceColumnName: "Power on 3/29",
              target: { kind: "create", name: "Hero Power" },
              entries: [{ memberId: "mem1", rawValue: "20" }],
            },
          ],
        ),
      ]),
    ).toThrow(/new period name may only appear once/i);
  });

  it("rejects invalid create period name and dates", () => {
    expect(() =>
      validateMultiPeriodImportGroups([
        group(
          { kind: "create", name: "   ", startsAt: null, endsAt: null },
          [
            {
              sourceColumnName: "Kills",
              target: { kind: "create", name: "Kills" },
              entries: [{ memberId: "mem1", rawValue: "1" }],
            },
          ],
        ),
      ]),
    ).toThrow(/name is required/i);

    expect(() =>
      validateMultiPeriodImportGroups([
        group(
          { kind: "create", name: "March", startsAt: "not-a-date", endsAt: null },
          [
            {
              sourceColumnName: "Kills",
              target: { kind: "create", name: "Kills" },
              entries: [{ memberId: "mem1", rawValue: "1" }],
            },
          ],
        ),
      ]),
    ).toThrow(/invalid start date/i);
  });

  it("rejects groups with no mappings", () => {
    expect(() =>
      validateMultiPeriodImportGroups([
        { target: { kind: "existing", periodId: "p1" }, mappings: [] },
      ]),
    ).toThrow(/at least one column mapping/i);
  });
});

describe("planMultiPeriodImportGroup", () => {
  it("allows mixed create and existing groups with per-period metric uniqueness", () => {
    const mapping = [
      {
        sourceColumnName: "Kills on 3/29",
        target: { kind: "existing" as const, metricId: "kills-a" },
        entries: [{ memberId: "mem1", rawValue: "100" }],
      },
    ];

    const existingPlan = planMultiPeriodImportGroup(
      group({ kind: "existing", periodId: "period-a" }, mapping),
      {
        periodMetricIds: ["kills-a"],
        libraryMetrics,
      },
    );
    const createPlan = planMultiPeriodImportGroup(
      group(
        { kind: "create", name: "March 2026", startsAt: "2026-03-01", endsAt: null },
        [
          {
            sourceColumnName: "Kills on 3/29",
            target: { kind: "create", name: "Kills" },
            entries: [{ memberId: "mem1", rawValue: "50" }],
          },
        ],
      ),
      { periodMetricIds: [], libraryMetrics },
    );

    expect(existingPlan.validated).toHaveLength(1);
    expect(createPlan.validated).toHaveLength(1);
    expect(createPlan.target.kind).toBe("create");
  });

  it("rejects duplicate metrics within one period group", () => {
    expect(() =>
      planMultiPeriodImportGroup(
        group({ kind: "existing", periodId: "period-a" }, [
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

  it("aggregates required permissions across groups including period creation", () => {
    const attachGroup = group({ kind: "existing", periodId: "period-a" }, [
      {
        sourceColumnName: "Library Metric",
        target: { kind: "existing", metricId: "lib-kills" },
        entries: [{ memberId: "mem1", rawValue: "1" }],
      },
    ]);
    const createMetricGroup = group({ kind: "existing", periodId: "period-b" }, [
      {
        sourceColumnName: "New Metric",
        target: { kind: "create", name: "New Metric" },
        entries: [{ memberId: "mem1", rawValue: "2" }],
      },
    ]);
    const createPeriodGroup = group(
      { kind: "create", name: "April 2026", startsAt: "2026-04-01", endsAt: null },
      [
        {
          sourceColumnName: "Kills",
          target: { kind: "create", name: "Kills" },
          entries: [{ memberId: "mem1", rawValue: "3" }],
        },
      ],
    );

    const attachPlan = planMultiPeriodImportGroup(attachGroup, {
      periodMetricIds: [],
      libraryMetrics,
    });
    const createMetricPlan = planMultiPeriodImportGroup(createMetricGroup, {
      periodMetricIds: [],
      libraryMetrics,
    });
    const createPeriodPlan = planMultiPeriodImportGroup(createPeriodGroup, {
      periodMetricIds: [],
      libraryMetrics,
    });

    const aggregated = aggregateRequiredPermissions(
      [attachPlan, createMetricPlan, createPeriodPlan],
      [attachGroup, createMetricGroup, createPeriodGroup],
    );
    expect(aggregated).toContain(Permissions.IMPORT_METRICS);
    expect(aggregated).toContain(Permissions.CONFIGURE_PERIODS);
    expect(aggregated).toContain(Permissions.CONFIGURE_METRICS);
  });
});
