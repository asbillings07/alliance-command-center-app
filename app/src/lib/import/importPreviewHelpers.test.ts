import { describe, it, expect } from "vitest";
import type { ColumnTranslation } from "@/app/src/lib/importTranslation";
import {
  columnTranslationRequiresAction,
  getDefaultOpenMetricColumnIndex,
  getMetricPreviewCounts,
  shouldSourceColumnTranslationsDefaultOpen,
  type MetricImportPreviewData,
} from "./importPreviewHelpers";

function metricTranslation(
  overrides: Partial<Extract<ColumnTranslation, { kind: "metric" }>> = {},
): Extract<ColumnTranslation, { kind: "metric" }> {
  return {
    kind: "metric",
    sourceColumnName: "Kill Points",
    columnIndex: 1,
    samples: ["100"],
    target: { kind: "existing", metricId: "met1" },
    classification: {
      columnIndex: 1,
      columnName: "Kill Points",
      intent: "likely_metric",
      reason: "matches_existing_metric",
      confidence: "high",
      needsConfirmation: false,
    },
    confirmationStatus: "confirmed_metric",
    status: "mapped",
    ...overrides,
  };
}

function preview(overrides: Partial<MetricImportPreviewData> = {}): MetricImportPreviewData {
  return {
    columnIndex: 1,
    columnName: "Kill Points",
    displayName: "Kill Points",
    proposedMetricName: "Kill Points",
    disposition: "existing",
    target: { kind: "existing", metricId: "met1" },
    summary: {
      total: 2,
      matched: 2,
      unmatched: 0,
      duplicates: 0,
      results: [
        {
          rawName: "Dragon",
          matchedName: "Dragon",
          memberId: "m1",
          value: 100,
          rawValue: "100",
          sourceRow: 2,
          confidence: 1,
          status: "matched",
        },
        {
          rawName: "Phoenix",
          matchedName: "Phoenix",
          memberId: "m2",
          value: 200,
          rawValue: "200",
          sourceRow: 3,
          confidence: 1,
          status: "matched",
        },
      ],
    },
    skippedBlankCells: [],
    invalidValueIssues: [],
    missingIdentityIssues: [],
    ...overrides,
  };
}

describe("importPreviewHelpers disclosure", () => {
  it("detects column translations that still require leader action", () => {
    expect(columnTranslationRequiresAction(metricTranslation())).toBe(false);
    expect(
      columnTranslationRequiresAction(
        metricTranslation({ confirmationStatus: "unconfirmed" }),
      ),
    ).toBe(true);
  });

  it("defaults source column translations open only when action is required", () => {
    const resolved: ColumnTranslation[] = [
      { kind: "identity", sourceColumnName: "Player", columnIndex: 0, samples: ["A"], targetLabel: "Member Identity", status: "mapped" },
      metricTranslation(),
    ];
    const unresolved: ColumnTranslation[] = [
      ...resolved,
      metricTranslation({
        sourceColumnName: "Mystery",
        columnIndex: 2,
        confirmationStatus: "unconfirmed",
        classification: {
          columnIndex: 2,
          columnName: "Mystery",
          intent: "unsure",
          reason: "ambiguous_name",
          confidence: "low",
          needsConfirmation: true,
        },
      }),
    ];

    expect(shouldSourceColumnTranslationsDefaultOpen(resolved)).toBe(false);
    expect(shouldSourceColumnTranslationsDefaultOpen(unresolved)).toBe(true);
  });

  it("classifies clean vs needs-review metric previews from counts", () => {
    expect(getMetricPreviewCounts(preview(), { m1: 0, m2: 1 })).toEqual({
      importableCount: 2,
      unmatchedCount: 0,
      invalidCount: 0,
      status: "ready",
    });

    expect(
      getMetricPreviewCounts(
        preview({
          summary: {
            ...preview().summary,
            unmatched: 1,
            results: [
              ...preview().summary.results,
              {
                rawName: "Unknown",
                value: undefined,
                rawValue: "999",
                sourceRow: 4,
                confidence: 0,
                status: "unmatched",
              },
            ],
          },
        }),
        {},
      ).status,
    ).toBe("needs_review");
  });

  it("focuses the first metric preview that still needs attention", () => {
    const clean = preview({ columnIndex: 1, displayName: "Clean Metric" });
    const unmatched = preview({
      columnIndex: 2,
      displayName: "Needs Review",
      summary: {
        ...preview().summary,
        unmatched: 1,
        results: [
          {
            rawName: "Ghost",
            value: undefined,
            rawValue: "50",
            sourceRow: 2,
            confidence: 0,
            status: "unmatched",
          },
        ],
      },
    });

    expect(
      getDefaultOpenMetricColumnIndex([clean, unmatched], {
        1: { m1: 0, m2: 1 },
        2: {},
      }),
    ).toBe(2);
  });
});
