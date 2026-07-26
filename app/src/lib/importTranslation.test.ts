import { describe, it, expect } from "vitest";
import {
  extractColumnSamples,
  buildPlannedMetricTranslationSummary,
  buildCommittedMetricTranslationSummary,
  buildPlannedRosterTranslationSummary,
  buildCommittedRosterTranslationSummary,
  type ColumnTranslation,
} from "./importTranslation";

describe("importTranslation helpers", () => {
  describe("extractColumnSamples", () => {
    it("extracts distinct nonblank samples from spreadsheet rows", () => {
      const rows = [
        ["Header A", "Header B"],
        ["Commander 1", "1,250"],
        ["Commander 2", "1,250"],
        ["Commander 3", "2,500"],
        ["Commander 4", "3,000"],
      ];

      const samples = extractColumnSamples(rows, 1, 1, 5, 3);
      expect(samples).toEqual(["1,250", "2,500", "3,000"]);
    });

    it("returns empty array for empty columns or out-of-range rows", () => {
      const rows = [
        ["Header A", "Header B"],
        ["Commander 1", "  "],
        ["Commander 2", ""],
      ];

      const samples = extractColumnSamples(rows, 1, 1, 3);
      expect(samples).toEqual([]);
    });
  });

  describe("buildPlannedMetricTranslationSummary", () => {
    it("correctly tallies metric targets and column kinds", () => {
      const translations: ColumnTranslation[] = [
        {
          kind: "identity",
          sourceColumnName: "Player",
          columnIndex: 0,
          samples: ["Alpha"],
          targetLabel: "Member Identity",
          status: "mapped",
        },
        {
          kind: "metric",
          sourceColumnName: "VS Kills",
          columnIndex: 1,
          samples: ["100"],
          target: { kind: "existing", metricId: "m1" },
          classification: {
            columnIndex: 1,
            columnName: "VS Kills",
            intent: "likely_metric",
            reason: "matches_existing_metric",
            confidence: "high",
            needsConfirmation: false,
          },
          confirmationStatus: "confirmed_metric",
          status: "mapped",
        },
        {
          kind: "metric",
          sourceColumnName: "Power",
          columnIndex: 2,
          samples: ["500"],
          target: { kind: "create", name: "Power" },
          classification: {
            columnIndex: 2,
            columnName: "Power",
            intent: "likely_metric",
            reason: "matches_metric_keyword",
            confidence: "high",
            needsConfirmation: false,
          },
          confirmationStatus: "confirmed_metric",
          status: "mapped",
        },
        {
          kind: "metric",
          sourceColumnName: "VS 7",
          columnIndex: 3,
          samples: ["50"],
          target: { kind: "skip" },
          classification: {
            columnIndex: 3,
            columnName: "VS 7",
            intent: "likely_period",
            reason: "matches_period_pattern",
            confidence: "medium",
            needsConfirmation: true,
          },
          confirmationStatus: "confirmed_skip",
          status: "skipped",
        },
        {
          kind: "unsupported",
          sourceColumnName: "Notes",
          columnIndex: 4,
          samples: ["Some text"],
          reason: "Unsupported",
          status: "excluded",
        },
        {
          kind: "empty",
          sourceColumnName: "Blank",
          columnIndex: 5,
          samples: [],
          reason: "No values in column",
          status: "ignored",
        },
      ];

      const summary = buildPlannedMetricTranslationSummary({
        periodName: "Week 28",
        translations,
        matchedMembersCount: 20,
        totalEntriesCount: 40,
      });

      expect(summary.destinationPeriodName).toBe("Week 28");
      expect(summary.reusedExistingMetricsCount).toBe(1);
      expect(summary.createdMetricsCount).toBe(1);
      expect(summary.skippedColumnsCount).toBe(1);
      expect(summary.unsupportedColumnsCount).toBe(1);
      expect(summary.emptyColumnsCount).toBe(1);
      expect(summary.matchedMembersCount).toBe(20);
      expect(summary.totalEntriesCount).toBe(40);
    });
  });

  describe("buildCommittedMetricTranslationSummary", () => {
    it("formats committed metrics result", () => {
      const summary = buildCommittedMetricTranslationSummary({
        periodName: "Week 28",
        result: {
          success: true,
          totalCount: 45,
          perMetric: [
            { metricId: "m1", name: "Kills", count: 25 },
            { metricId: "m2", name: "Power", count: 20 },
          ],
          created: [{ metricId: "m2", name: "Power" }],
          attached: [],
          reused: [{ metricId: "m1", name: "Kills" }],
        },
      });

      expect(summary.destinationPeriodName).toBe("Week 28");
      expect(summary.totalValuesCommitted).toBe(45);
      expect(summary.createdMetrics).toHaveLength(1);
      expect(summary.reusedMetrics).toHaveLength(1);
      expect(summary.perMetricCounts).toHaveLength(2);
    });
  });

  describe("buildPlannedRosterTranslationSummary and buildCommittedRosterTranslationSummary", () => {
    it("truthfully summarizes roster outcomes", () => {
      const planned = buildPlannedRosterTranslationSummary({
        membersToCreateCount: 5,
        archivedMembersToRestoreCount: 2,
        existingActiveMembersUnchangedCount: 15,
        unsupportedColumnsCount: 1,
        emptyColumnsCount: 1,
        totalRowsProcessed: 24,
      });

      expect(planned.membersToCreateCount).toBe(5);
      expect(planned.archivedMembersToRestoreCount).toBe(2);
      expect(planned.existingActiveMembersUnchangedCount).toBe(15);

      const committed = buildCommittedRosterTranslationSummary({
        result: {
          created: 5,
          restored: 2,
          skippedExisting: 15,
          skippedDuplicates: 1,
          skippedEmptyNames: 1,
          skippedUnselected: 0,
          errors: [],
        },
      });

      expect(committed.createdCount).toBe(5);
      expect(committed.restoredCount).toBe(2);
      expect(committed.skippedExistingCount).toBe(15);
    });
  });
});
