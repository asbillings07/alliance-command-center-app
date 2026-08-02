import { describe, it, expect } from "vitest";
import { MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import type { AllianceFinding } from "@/app/src/lib/reports/allianceFindings";
import { formatFindingText, FINDING_KIND_BADGE } from "./allianceFindingsDisplay";

describe("FINDING_KIND_BADGE", () => {
  it("provides a label and semantic variant for every finding kind", () => {
    const kinds: AllianceFinding["kind"][] = [
      "INACTIVE_ATTACHMENT",
      "MISSING_RESULTS",
      "INVALID_VALUES",
      "INCOMPLETE_COVERAGE",
      "ADVERSE_COMPARISON",
    ];
    for (const kind of kinds) {
      expect(FINDING_KIND_BADGE[kind].label).toBeTruthy();
      expect(FINDING_KIND_BADGE[kind].variant).toBeTruthy();
    }
  });
});

describe("formatFindingText", () => {
  it("describes an inactive attachment, avoiding a possessive, with reactivation guidance", () => {
    expect(
      formatFindingText({ kind: "INACTIVE_ATTACHMENT", metricId: "m1", metricName: "Donations" }),
    ).toBe("Attachment for Donations is inactive this period. Reactivate it to resume recording new results.");
  });

  it("describes missing results, with recovery guidance", () => {
    expect(formatFindingText({ kind: "MISSING_RESULTS", metricId: "m1", metricName: "Donations" })).toBe(
      "Donations has no results recorded yet this period. Record results for active members to start tracking it.",
    );
  });

  it("describes invalid values, pluralizing correctly for one vs. many, with recovery guidance", () => {
    expect(
      formatFindingText({ kind: "INVALID_VALUES", metricId: "m1", metricName: "Showed Up", invalidCount: 1 }),
    ).toBe("Showed Up has 1 active member with an invalid recorded value. Review and correct the invalid entry.");
    expect(
      formatFindingText({ kind: "INVALID_VALUES", metricId: "m1", metricName: "Showed Up", invalidCount: 3 }),
    ).toBe(
      "Showed Up has 3 active members with an invalid recorded value. Review and correct the invalid entries.",
    );
  });

  it("describes incomplete coverage with missing/total counts, with recovery guidance", () => {
    expect(
      formatFindingText({
        kind: "INCOMPLETE_COVERAGE",
        metricId: "m1",
        metricName: "Donations",
        missingCount: 3,
        currentActiveMemberCount: 10,
      }),
    ).toBe(
      "Donations: 3 of 10 active members haven't recorded a value. Record results for the remaining members to complete coverage.",
    );
  });

  it("describes an adverse decrease for HIGHER_IS_BETTER with a plain signed change, no redundant direction word", () => {
    expect(
      formatFindingText({
        kind: "ADVERSE_COMPARISON",
        metricId: "m1",
        metricName: "Donations",
        summaryKind: MetricSummaryKind.SUM,
        trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
        unitLabel: "pts",
        absoluteChange: -50,
        percentageChange: -10,
      }),
    ).toBe(
      "Donations changed -50 pts (-10%) since the comparison period (configured as higher is better). Review the drill-down for member-level detail.",
    );
  });

  it("describes an adverse increase for LOWER_IS_BETTER with a plain signed change", () => {
    expect(
      formatFindingText({
        kind: "ADVERSE_COMPARISON",
        metricId: "m1",
        metricName: "Response Time",
        summaryKind: MetricSummaryKind.AVERAGE,
        trendDirection: MetricTrendDirection.LOWER_IS_BETTER,
        unitLabel: "hrs",
        absoluteChange: 2,
        percentageChange: 20,
      }),
    ).toBe(
      "Response Time changed +2 hrs (+20%) since the comparison period (configured as lower is better). Review the drill-down for member-level detail.",
    );
  });

  it("fails closed (throws) for an unhandled finding kind instead of silently rendering blank copy", () => {
    const bogusFinding = { kind: "SOME_FUTURE_KIND" } as unknown as AllianceFinding;
    expect(() => formatFindingText(bogusFinding)).toThrow("Unhandled finding kind: SOME_FUTURE_KIND");
  });
});
