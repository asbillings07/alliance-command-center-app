import { describe, it, expect } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import type { MetricInfo, MetricReportRow } from "@/app/src/lib/reports/getMetricSummaryReport";
import {
  formatRowRank,
  formatRowValue,
  formatRowKindSpecific,
  metricReportKindSpecificColumnLabel,
} from "./reportRowDisplay";

function metric(overrides: Partial<MetricInfo> = {}): MetricInfo {
  return {
    id: "metric-1",
    name: "VS Score",
    type: Metric_Type.NUMERIC,
    summaryKind: MetricSummaryKind.SUM,
    unitLabel: null,
    active: true,
    trendDirection: MetricTrendDirection.NEUTRAL,
    ...overrides,
  };
}

function row(overrides: Partial<MetricReportRow> = {}): MetricReportRow {
  return {
    allianceMemberId: "member-1",
    playerName: "Alice",
    archived: false,
    value: 100,
    rank: 1,
    booleanStatus: null,
    share: null,
    differenceFromAverage: null,
    ...overrides,
  };
}

describe("formatRowRank", () => {
  it("shows the rank for a NUMERIC metric", () => {
    expect(formatRowRank(row({ rank: 3 }), metric())).toBe("#3");
  });

  it("shows an em dash when a NUMERIC row has no rank (missing value)", () => {
    expect(formatRowRank(row({ rank: null }), metric())).toBe("—");
  });

  it("shows the rank for a NONE-kind BOOLEAN metric — NONE's contract includes ranking regardless of type", () => {
    expect(
      formatRowRank(row({ rank: 1 }), metric({ type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.NONE })),
    ).toBe("#1");
  });

  it("hides rank for TRUE_RATE — its contract is yes/no counts and rate, not ranking", () => {
    expect(
      formatRowRank(row({ rank: 1 }), metric({ type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE })),
    ).toBeNull();
  });
});

describe("formatRowValue", () => {
  it("formats a NUMERIC value compactly with an exact tooltip", () => {
    const display = formatRowValue(row({ value: 1_000_000 }), metric());
    expect(display.text).toBe("1M");
    expect(display.title).toBe("1,000,000");
  });

  it("shows Missing for a null NUMERIC value", () => {
    expect(formatRowValue(row({ value: null }), metric()).text).toBe("Missing");
  });

  it.each([
    ["TRUE", "Yes"],
    ["FALSE", "No"],
    ["INVALID", "Invalid"],
    ["MISSING", "Missing"],
  ] as const)("maps BOOLEAN status %s to %s", (status, label) => {
    const display = formatRowValue(
      row({ booleanStatus: status, value: status === "MISSING" ? null : 1 }),
      metric({ type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE }),
    );
    expect(display.text).toBe(label);
  });
});

describe("formatRowKindSpecific", () => {
  it("formats an available SUM share", () => {
    const value = formatRowKindSpecific(
      row({ value: 25, share: { available: true, percentageOfTotal: 25 } }),
      metric({ summaryKind: MetricSummaryKind.SUM }),
    );
    expect(value).toBe("25%");
  });

  it("explains a non-positive-total unavailable share", () => {
    const value = formatRowKindSpecific(
      row({ value: 25, share: { available: false, reason: "NON_POSITIVE_TOTAL" } }),
      metric({ summaryKind: MetricSummaryKind.SUM }),
    );
    expect(value).toBe("Unavailable (total isn't positive)");
  });

  it("explains a negative-values-present unavailable share", () => {
    const value = formatRowKindSpecific(
      row({ value: 25, share: { available: false, reason: "NEGATIVE_VALUES_PRESENT" } }),
      metric({ summaryKind: MetricSummaryKind.SUM }),
    );
    expect(value).toBe("Unavailable (total includes negative values)");
  });

  it("returns null for SUM when the row has no value", () => {
    expect(formatRowKindSpecific(row({ value: null, share: null }), metric({ summaryKind: MetricSummaryKind.SUM }))).toBeNull();
  });

  it("formats a positive difference from average with a plus sign", () => {
    const value = formatRowKindSpecific(
      row({ differenceFromAverage: 4.5 }),
      metric({ summaryKind: MetricSummaryKind.AVERAGE }),
    );
    expect(value).toBe("+4.5");
  });

  it("formats a negative difference from average without a double sign", () => {
    const value = formatRowKindSpecific(
      row({ differenceFromAverage: -4.5 }),
      metric({ summaryKind: MetricSummaryKind.AVERAGE }),
    );
    expect(value).toBe("-4.5");
  });

  it("returns null for TRUE_RATE (no fourth column)", () => {
    expect(
      formatRowKindSpecific(row(), metric({ type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE })),
    ).toBeNull();
  });

  it("returns null for NONE (no fourth column)", () => {
    expect(formatRowKindSpecific(row(), metric({ summaryKind: MetricSummaryKind.NONE }))).toBeNull();
  });
});

describe("metricReportKindSpecificColumnLabel", () => {
  it("labels SUM as Share of total", () => {
    expect(metricReportKindSpecificColumnLabel(MetricSummaryKind.SUM)).toBe("Share of total");
  });

  it("labels AVERAGE as Vs. average", () => {
    expect(metricReportKindSpecificColumnLabel(MetricSummaryKind.AVERAGE)).toBe("Vs. average");
  });

  it("has no label for TRUE_RATE", () => {
    expect(metricReportKindSpecificColumnLabel(MetricSummaryKind.TRUE_RATE)).toBeNull();
  });

  it("has no label for NONE", () => {
    expect(metricReportKindSpecificColumnLabel(MetricSummaryKind.NONE)).toBeNull();
  });
});
