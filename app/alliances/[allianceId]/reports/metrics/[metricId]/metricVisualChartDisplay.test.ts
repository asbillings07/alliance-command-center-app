import { describe, it, expect } from "vitest";
import type { DistributionBin, SumTopContributor } from "@/app/src/lib/reports/metricVisualModel";
import {
  pluralize,
  classifySumDivergingMode,
  maxAbsoluteContributorValue,
  formatSignedMetricValue,
  formatExactMetricValue,
  pickHistogramBoundaryPrecision,
  formatHistogramBoundary,
  formatBinRangeLabel,
  formatAverageMarkerLabel,
  clampAverageMarkerLabelPosition,
} from "./metricVisualChartDisplay";

function contributor(overrides: Partial<SumTopContributor> = {}): SumTopContributor {
  return {
    allianceMemberId: "m1",
    playerName: "Alice",
    archived: false,
    value: 10,
    percentageOfTotal: null,
    ...overrides,
  };
}

describe("pluralize", () => {
  it("uses the singular form for exactly 1", () => {
    expect(pluralize(1, "member", "members")).toBe("member");
  });

  it("uses the plural form for 0 and for more than 1", () => {
    expect(pluralize(0, "member", "members")).toBe("members");
    expect(pluralize(2, "member", "members")).toBe("members");
  });
});

describe("classifySumDivergingMode", () => {
  it("classifies NON_POSITIVE_TOTAL as ALL_ZERO regardless of the (necessarily all-zero) contributors", () => {
    const mode = classifySumDivergingMode({ available: false, reason: "NON_POSITIVE_TOTAL" }, [
      contributor({ value: 0 }),
    ]);
    expect(mode).toBe("ALL_ZERO");
  });

  it("classifies NEGATIVE_VALUES_PRESENT with at least one positive contributor as MIXED", () => {
    const mode = classifySumDivergingMode({ available: false, reason: "NEGATIVE_VALUES_PRESENT" }, [
      contributor({ value: 100 }),
      contributor({ value: -20 }),
    ]);
    expect(mode).toBe("MIXED");
  });

  it("classifies NEGATIVE_VALUES_PRESENT with no positive contributor as ALL_NEGATIVE, never MIXED", () => {
    const mode = classifySumDivergingMode({ available: false, reason: "NEGATIVE_VALUES_PRESENT" }, [
      contributor({ value: -20 }),
      contributor({ value: -5 }),
    ]);
    expect(mode).toBe("ALL_NEGATIVE");
  });
});

describe("maxAbsoluteContributorValue", () => {
  it("returns the largest magnitude across both signs", () => {
    const value = maxAbsoluteContributorValue([
      contributor({ value: 50 }),
      contributor({ value: -1000 }),
      contributor({ value: 30 }),
    ]);
    expect(value).toBe(1000);
  });

  it("returns 0 for an empty cohort", () => {
    expect(maxAbsoluteContributorValue([])).toBe(0);
  });
});

describe("formatSignedMetricValue", () => {
  it("prefixes a positive value with '+' and includes the unit", () => {
    expect(formatSignedMetricValue(120, "pts")).toBe("+120 pts");
  });

  it("does not double a negative value's own '-' sign", () => {
    expect(formatSignedMetricValue(-35, "pts")).toBe("-35 pts");
  });

  it("renders exactly '0' for a zero value, with no sign", () => {
    expect(formatSignedMetricValue(0, "pts")).toBe("0 pts");
  });

  it("omits the unit entirely when unitLabel is null", () => {
    expect(formatSignedMetricValue(120, null)).toBe("+120");
  });
});

describe("formatExactMetricValue", () => {
  it("never collapses distinct values the way compact formatting would", () => {
    // formatMetricValue(...).compact renders both of these as "1M" — the
    // exact table value must keep them distinguishable.
    expect(formatExactMetricValue(999_950, null)).toBe("999,950");
    expect(formatExactMetricValue(1_000_000, null)).toBe("1,000,000");
  });

  it("includes the unit label when present", () => {
    expect(formatExactMetricValue(1234, "pts")).toBe("1,234 pts");
  });

  it("omits the unit entirely when unitLabel is null", () => {
    expect(formatExactMetricValue(1234, null)).toBe("1,234");
  });
});

describe("pickHistogramBoundaryPrecision", () => {
  it("returns 0 for whole-number boundaries", () => {
    const bins: DistributionBin[] = [
      { rangeStart: 0, rangeEnd: 10, count: 2 },
      { rangeStart: 10, rangeEnd: 20, count: 3 },
    ];
    expect(pickHistogramBoundaryPrecision(bins)).toBe(0);
  });

  it("returns 0 for an empty bin set", () => {
    expect(pickHistogramBoundaryPrecision([])).toBe(0);
  });

  it("increases precision only as far as needed to keep every boundary visually distinct", () => {
    // width = 1/3 ≈ 0.333... — 0 decimals would collapse rangeStart(0.33) and
    // rangeEnd(0.33) of adjacent narrow bins to the same "0"/"1" in some
    // spots; 1 decimal is enough to distinguish every boundary here.
    const bins: DistributionBin[] = [
      { rangeStart: 0, rangeEnd: 1 / 3, count: 1 },
      { rangeStart: 1 / 3, rangeEnd: 2 / 3, count: 1 },
      { rangeStart: 2 / 3, rangeEnd: 1, count: 1 },
    ];
    const precision = pickHistogramBoundaryPrecision(bins);
    const boundaries = [bins[0]!.rangeStart, ...bins.map((b) => b.rangeEnd)];
    const rendered = boundaries.map((v) => v.toFixed(precision));
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("never exceeds the precision cap even for boundaries that would need more to fully disambiguate", () => {
    // Six boundaries packed into a vanishingly small range — capped at 4
    // decimals rather than growing unbounded.
    const bins: DistributionBin[] = [
      { rangeStart: 0, rangeEnd: 0.00001, count: 1 },
      { rangeStart: 0.00001, rangeEnd: 0.00002, count: 1 },
    ];
    expect(pickHistogramBoundaryPrecision(bins)).toBe(4);
  });
});

describe("formatHistogramBoundary", () => {
  it("pads to the requested precision", () => {
    expect(formatHistogramBoundary(7, 2, null)).toBe("7.00");
    expect(formatHistogramBoundary(7, 0, null)).toBe("7");
  });

  it("includes the unit label when present", () => {
    expect(formatHistogramBoundary(7, 0, "pts")).toBe("7 pts");
  });
});

describe("formatBinRangeLabel", () => {
  it("uses a half-open interval for every bin except the last", () => {
    const bin: DistributionBin = { rangeStart: 0, rangeEnd: 10, count: 5 };
    expect(formatBinRangeLabel(bin, false, 0, null)).toBe("0 ≤ value < 10");
  });

  it("uses a closed interval (≤ on both ends) for the last bin", () => {
    const bin: DistributionBin = { rangeStart: 50, rangeEnd: 60, count: 5 };
    expect(formatBinRangeLabel(bin, true, 0, null)).toBe("50 ≤ value ≤ 60");
  });

  it("includes the unit label on both boundaries", () => {
    const bin: DistributionBin = { rangeStart: 0, rangeEnd: 10, count: 5 };
    expect(formatBinRangeLabel(bin, false, 0, "pts")).toBe("0 pts ≤ value < 10 pts");
  });
});

describe("clampAverageMarkerLabelPosition", () => {
  const VIEWBOX_WIDTH = 320;
  const PADDING = 6;

  it("centers the label on the marker when there's room on both sides", () => {
    const position = clampAverageMarkerLabelPosition(160, "Average: 7.4 pts", VIEWBOX_WIDTH, PADDING);
    expect(position).toEqual({ x: 160, textAnchor: "middle" });
  });

  it("anchors the label to the left edge instead of clipping when the marker sits near the domain minimum", () => {
    // A long label centered this close to x=6 would render partly off the
    // left edge of the viewBox under textAnchor="middle".
    const position = clampAverageMarkerLabelPosition(6, "Average: 1,234.5678 pts", VIEWBOX_WIDTH, PADDING);
    expect(position.textAnchor).toBe("start");
    expect(position.x).toBe(PADDING);
  });

  it("anchors the label to the right edge instead of clipping when the marker sits near the domain maximum", () => {
    const position = clampAverageMarkerLabelPosition(314, "Average: 1,234.5678 pts", VIEWBOX_WIDTH, PADDING);
    expect(position.textAnchor).toBe("end");
    expect(position.x).toBe(VIEWBOX_WIDTH - PADDING);
  });

  it("keeps a short label centered close to an edge, as long as it genuinely fits without clipping", () => {
    const position = clampAverageMarkerLabelPosition(50, "Average: 5", VIEWBOX_WIDTH, PADDING);
    expect(position).toEqual({ x: 50, textAnchor: "middle" });
  });
});

describe("formatAverageMarkerLabel", () => {
  it("labels the marker with the formatted average and unit", () => {
    expect(formatAverageMarkerLabel(7.4, "pts")).toBe("Average: 7.4 pts");
  });

  it("omits the unit when there isn't one", () => {
    expect(formatAverageMarkerLabel(10, null)).toBe("Average: 10");
  });
});
