import { describe, it, expect } from "vitest";
import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import type { MetricRollup } from "@/app/src/lib/reports/getMetricSummaryReport";
import { formatRollupHeadline, formatRollupChange } from "./reportRollupDisplay";

describe("formatRollupHeadline", () => {
  it("formats a SUM total compactly", () => {
    const rollup: MetricRollup = { kind: "SUM", total: 1_500_000, hasNegativeValues: false };
    expect(formatRollupHeadline(rollup, "pts")).toBe("1.5M pts");
  });

  it("formats an AVERAGE with precision", () => {
    const rollup: MetricRollup = { kind: "AVERAGE", average: 42.5 };
    expect(formatRollupHeadline(rollup, null)).toBe("42.5");
  });

  it("returns null for an AVERAGE with no valid entries", () => {
    const rollup: MetricRollup = { kind: "AVERAGE", average: null };
    expect(formatRollupHeadline(rollup, null)).toBeNull();
  });

  it("formats a TRUE_RATE as a percentage", () => {
    const rollup: MetricRollup = { kind: "TRUE_RATE", trueCount: 3, falseCount: 1, invalidCount: 0, trueRate: 75 };
    expect(formatRollupHeadline(rollup, null)).toBe("75%");
  });

  it("returns null for a TRUE_RATE with no valid entries", () => {
    const rollup: MetricRollup = { kind: "TRUE_RATE", trueCount: 0, falseCount: 0, invalidCount: 2, trueRate: null };
    expect(formatRollupHeadline(rollup, null)).toBeNull();
  });

  it("returns null for NONE", () => {
    expect(formatRollupHeadline({ kind: "NONE" }, null)).toBeNull();
  });
});

describe("formatRollupChange", () => {
  it("formats a positive SUM change with a plus sign and percentage", () => {
    const value = formatRollupChange(MetricSummaryKind.SUM, 500, 12.3, "pts");
    expect(value).toBe("+500 pts (+12.3%)");
  });

  it("formats a negative SUM change without a double sign", () => {
    const value = formatRollupChange(MetricSummaryKind.SUM, -500, -12.3, "pts");
    expect(value).toBe("-500 pts (-12.3%)");
  });

  it("shows percentage as unavailable when the comparison total was non-positive", () => {
    const value = formatRollupChange(MetricSummaryKind.SUM, 500, null, null);
    expect(value).toBe("+500 (unavailable)");
  });

  it("returns null for SUM when absoluteChange is null", () => {
    expect(formatRollupChange(MetricSummaryKind.SUM, null, null, null)).toBeNull();
  });

  it("formats an AVERAGE change", () => {
    const value = formatRollupChange(MetricSummaryKind.AVERAGE, 2.5, 10, null);
    expect(value).toBe("+2.5 (+10%)");
  });

  it("formats a TRUE_RATE change as signed percentage points, with no percentageChange shown", () => {
    const value = formatRollupChange(MetricSummaryKind.TRUE_RATE, 15, null, null);
    expect(value).toBe("+15pp");
  });

  it("formats a negative TRUE_RATE change", () => {
    const value = formatRollupChange(MetricSummaryKind.TRUE_RATE, -15, null, null);
    expect(value).toBe("-15pp");
  });

  it("returns null for TRUE_RATE when absoluteChange is null", () => {
    expect(formatRollupChange(MetricSummaryKind.TRUE_RATE, null, null, null)).toBeNull();
  });

  it("returns null for NONE", () => {
    expect(formatRollupChange(MetricSummaryKind.NONE, 10, 10, null)).toBeNull();
  });
});
