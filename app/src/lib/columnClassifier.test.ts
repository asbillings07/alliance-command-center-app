import { describe, it, expect } from "vitest";
import { classifyColumn } from "./columnClassifier";

describe("classifyColumn", () => {
  const periodMetrics = [
    { id: "m1", name: "Kill Points" },
    { id: "m2", name: "VS Score" },
  ];

  const libraryMetrics = [
    { id: "m3", name: "Tech Donations" },
    { id: "m4", name: "Hero Power" },
  ];

  it("classifies columns matching metrics attached to the period as matches_existing_metric", () => {
    const result = classifyColumn({
      columnIndex: 1,
      columnName: "Kill Points",
      periodMetrics,
      libraryMetrics,
    });

    expect(result).toEqual({
      columnIndex: 1,
      columnName: "Kill Points",
      intent: "likely_metric",
      reason: "matches_existing_metric",
      confidence: "high",
      needsConfirmation: false,
      matchedMetricId: "m1",
      matchedMetricName: "Kill Points",
    });
  });

  it("classifies columns matching metrics in the alliance library as matches_library_metric", () => {
    const result = classifyColumn({
      columnIndex: 2,
      columnName: "Tech Donations",
      periodMetrics,
      libraryMetrics,
    });

    expect(result).toEqual({
      columnIndex: 2,
      columnName: "Tech Donations",
      intent: "likely_metric",
      reason: "matches_library_metric",
      confidence: "high",
      needsConfirmation: false,
      matchedMetricId: "m3",
      matchedMetricName: "Tech Donations",
    });
  });

  it("classifies period and date patterns as matches_period_pattern requiring confirmation", () => {
    const periodColumns = [
      "VS 7",
      "vs7",
      "Week 4",
      "Wk 2",
      "W28",
      "Season 5",
      "S5",
      "Battle 3",
      "B2",
      "Round 1",
      "Day 1",
      "7/18",
      "2026-07-18",
    ];

    for (const colName of periodColumns) {
      const result = classifyColumn({
        columnIndex: 0,
        columnName: colName,
        periodMetrics: [],
        libraryMetrics: [],
      });

      expect(result.intent).toBe("likely_period");
      expect(result.reason).toBe("matches_period_pattern");
      expect(result.needsConfirmation).toBe(true);
    }
  });

  it("classifies recognized metric keywords as matches_metric_keyword without requiring confirmation", () => {
    const metricColumns = [
      "Kills",
      "Donations",
      "THP",
      "Power",
      "Captures",
      "Merit",
      "Contributions",
    ];

    for (const colName of metricColumns) {
      const result = classifyColumn({
        columnIndex: 1,
        columnName: colName,
        periodMetrics: [],
        libraryMetrics: [],
      });

      expect(result.intent).toBe("likely_metric");
      expect(result.reason).toBe("matches_metric_keyword");
      expect(result.needsConfirmation).toBe(false);
    }
  });

  it("correctly distinguishes VS Score (metric keyword) from VS 7 (period pattern) on the same sheet", () => {
    const vsScoreResult = classifyColumn({
      columnIndex: 1,
      columnName: "VS Score",
      periodMetrics: [],
      libraryMetrics: [],
    });

    expect(vsScoreResult.intent).toBe("likely_metric");
    expect(vsScoreResult.reason).toBe("matches_metric_keyword");
    expect(vsScoreResult.needsConfirmation).toBe(false);

    const vs7Result = classifyColumn({
      columnIndex: 2,
      columnName: "VS 7",
      periodMetrics: [],
      libraryMetrics: [],
    });

    expect(vs7Result.intent).toBe("likely_period");
    expect(vs7Result.reason).toBe("matches_period_pattern");
    expect(vs7Result.needsConfirmation).toBe(true);
  });

  it("classifies unrecognized and ambiguous column names including Score and Points as ambiguous_name", () => {
    const ambiguousColumns = ["Score", "Points", "Event", "Result", "Overview", "Column 3", "Category"];

    for (const colName of ambiguousColumns) {
      const result = classifyColumn({
        columnIndex: 3,
        columnName: colName,
        periodMetrics: [],
        libraryMetrics: [],
      });

      expect(result.intent).toBe("unsure");
      expect(result.reason).toBe("ambiguous_name");
      expect(result.confidence).toBe("low");
      expect(result.needsConfirmation).toBe(false);
    }
  });

  it("respects strict evaluation order when a column name matches an existing metric that happens to look like a period", () => {
    const customPeriodMetrics = [{ id: "m-custom", name: "VS 7" }];

    const result = classifyColumn({
      columnIndex: 0,
      columnName: "VS 7",
      periodMetrics: customPeriodMetrics,
      libraryMetrics: [],
    });

    expect(result.intent).toBe("likely_metric");
    expect(result.reason).toBe("matches_existing_metric");
    expect(result.needsConfirmation).toBe(false);
    expect(result.matchedMetricId).toBe("m-custom");
  });
});
