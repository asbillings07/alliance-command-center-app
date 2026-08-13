import { describe, it, expect } from "vitest";
import { MetricSummaryKind, MetricTrendDirection, Metric_Type } from "@/app/generated/prisma/enums";
import { computeAllianceFindings } from "@/app/src/lib/reports/allianceFindings";
import type { AllianceMetricPerformance, AllianceMetricComparison } from "@/app/src/lib/reports/getAlliancePerformanceReport";
import type { MetricCoverage, MetricPeriodAttachmentStatus, MetricPeriodDataStatus } from "@/app/src/lib/reports/getMetricSummaryReport";
import { DASHBOARD_ACTIONABLE_FINDING_KINDS, countActionableFindings } from "./getDashboardFindingsSummary";

// Mirrors allianceFindings.test.ts's own fixture helper, so this contract
// test builds findings from the same shape the real engine consumes.
function performance(overrides: Partial<AllianceMetricPerformance> = {}): AllianceMetricPerformance {
  return {
    metric: {
      id: "metric-1",
      name: "Donations",
      type: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.SUM,
      unitLabel: "pts",
      active: true,
      trendDirection: MetricTrendDirection.NEUTRAL,
    },
    attachmentStatus: "ACTIVE" as MetricPeriodAttachmentStatus,
    dataStatus: "HAS_VALUES" as MetricPeriodDataStatus,
    rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
    coverage: {
      currentActiveMemberCount: 10,
      recordedActiveMemberCount: 10,
      invalidActiveMemberCount: 0,
      missingActiveMemberCount: 0,
      complete: true,
      archivedContributingMemberCount: 0,
    } satisfies MetricCoverage,
    comparison: null,
    ...overrides,
  };
}

function compared(overrides: Partial<Extract<AllianceMetricComparison, { status: "COMPARED" }>> = {}): AllianceMetricComparison {
  return {
    status: "COMPARED",
    rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
    absoluteChange: 0,
    percentageChange: 0,
    ...overrides,
  };
}

describe("DASHBOARD_ACTIONABLE_FINDING_KINDS contract", () => {
  it("names every AllianceFinding kind explicitly — defense-in-depth alongside the compiler-enforced Record type", () => {
    // Kept as a literal list (not imported) deliberately: this is the
    // second line of defense described in the contract doc comment, so it
    // must not silently pass by re-deriving its expectation from the same
    // map it's checking.
    const knownKinds = [
      "NOT_ATTACHED",
      "INACTIVE_ATTACHMENT",
      "MISSING_RESULTS",
      "INVALID_VALUES",
      "INCOMPLETE_COVERAGE",
      "ADVERSE_COMPARISON",
      "COMPARISON_UNAVAILABLE",
    ];

    expect(Object.keys(DASHBOARD_ACTIONABLE_FINDING_KINDS).sort()).toEqual(knownKinds.sort());
  });

  it.each([
    ["MISSING_RESULTS", true],
    ["INVALID_VALUES", true],
    ["INCOMPLETE_COVERAGE", true],
    ["NOT_ATTACHED", true],
    ["INACTIVE_ATTACHMENT", true],
    ["ADVERSE_COMPARISON", false],
    ["COMPARISON_UNAVAILABLE", false],
  ] as const)("%s is included=%s", (kind, expected) => {
    expect(DASHBOARD_ACTIONABLE_FINDING_KINDS[kind]).toBe(expected);
  });
});

describe("countActionableFindings", () => {
  it("returns 0 for an empty findings list (no metrics, no members, no attachments)", () => {
    expect(countActionableFindings(computeAllianceFindings([]))).toBe(0);
  });

  it("returns 0 for a fully healthy, fully covered, unchanged metric", () => {
    const findings = computeAllianceFindings([performance({ comparison: compared({ absoluteChange: 0 }) })]);
    expect(countActionableFindings(findings)).toBe(0);
  });

  it("counts MISSING_RESULTS, INVALID_VALUES, and INCOMPLETE_COVERAGE as actionable", () => {
    const missing = performance({
      metric: { ...performance().metric, id: "m-missing" },
      dataStatus: "NO_VALUES",
    });
    const invalid = performance({
      metric: { ...performance().metric, id: "m-invalid" },
      coverage: {
        currentActiveMemberCount: 10,
        recordedActiveMemberCount: 8,
        invalidActiveMemberCount: 2,
        missingActiveMemberCount: 0,
        complete: false,
        archivedContributingMemberCount: 0,
      },
    });
    const incomplete = performance({
      metric: { ...performance().metric, id: "m-incomplete" },
      coverage: {
        currentActiveMemberCount: 10,
        recordedActiveMemberCount: 7,
        invalidActiveMemberCount: 0,
        missingActiveMemberCount: 3,
        complete: false,
        archivedContributingMemberCount: 0,
      },
    });

    const findings = computeAllianceFindings([missing, invalid, incomplete]);
    expect(countActionableFindings(findings)).toBe(3);
  });

  it("does not count ADVERSE_COMPARISON or COMPARISON_UNAVAILABLE — comparison-only kinds this adapter never requests a comparison period for", () => {
    const adverse = performance({
      metric: {
        ...performance().metric,
        id: "m-adverse",
        trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
      },
      comparison: compared({ absoluteChange: -50 }),
    });
    const unavailable = performance({
      metric: { ...performance().metric, id: "m-unavailable" },
      attachmentStatus: "ACTIVE",
      comparison: { status: "NOT_ATTACHED" } satisfies AllianceMetricComparison,
    });

    const findings = computeAllianceFindings([adverse, unavailable]);
    // Sanity check: the engine really did produce these two kinds here —
    // otherwise a 0 count below would prove nothing about the filter.
    expect(findings.map((f) => f.kind).sort()).toEqual(["ADVERSE_COMPARISON", "COMPARISON_UNAVAILABLE"].sort());
    expect(countActionableFindings(findings)).toBe(0);
  });

  it("mixed actionable and non-actionable findings: counts only the actionable ones, regardless of severity order", () => {
    const invalid = performance({
      metric: { ...performance().metric, id: "m-invalid" },
      coverage: {
        currentActiveMemberCount: 10,
        recordedActiveMemberCount: 8,
        invalidActiveMemberCount: 2,
        missingActiveMemberCount: 0,
        complete: false,
        archivedContributingMemberCount: 0,
      },
      comparison: compared({ absoluteChange: 0 }),
    });
    const notAttached = performance({
      metric: { ...performance().metric, id: "m-not-attached" },
      attachmentStatus: "NOT_ATTACHED",
      dataStatus: "NO_VALUES",
    });
    const adverse = performance({
      metric: {
        ...performance().metric,
        id: "m-adverse",
        trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
      },
      comparison: compared({ absoluteChange: -50 }),
    });

    const findings = computeAllianceFindings([invalid, notAttached, adverse]);
    expect(countActionableFindings(findings)).toBe(2);
  });
});
