import type { ColumnClassification } from "./columnClassifier";

export type ColumnTarget =
  | { kind: "skip" }
  | { kind: "existing"; metricId: string }
  | { kind: "attach"; metricId: string }
  | { kind: "create"; name: string };

export type ColumnTranslation =
  | {
      kind: "identity";
      sourceColumnName: string;
      columnIndex: number;
      samples: string[];
      targetLabel: "Member Identity";
      status: "mapped";
    }
  | {
      kind: "member_property";
      sourceColumnName: string;
      columnIndex: number;
      samples: string[];
      property: "thp" | "role";
      targetLabel: string;
      status: "mapped";
    }
  | {
      kind: "metric";
      sourceColumnName: string;
      columnIndex: number;
      samples: string[];
      target: ColumnTarget;
      classification: ColumnClassification;
      confirmationStatus: "unconfirmed" | "confirmed_skip" | "confirmed_metric";
      status: "mapped" | "unconfirmed" | "skipped";
    }
  | {
      kind: "unsupported";
      sourceColumnName: string;
      columnIndex: number;
      samples: string[];
      reason: string;
      status: "excluded";
    }
  | {
      kind: "empty";
      sourceColumnName: string;
      columnIndex: number;
      samples: [];
      reason: "No values in column";
      status: "ignored";
    };

export function extractColumnSamples(
  rows: string[][],
  columnIndex: number,
  dataStartIndex = 1,
  dataEndIndex?: number,
  maxSamples = 3,
): string[] {
  const samples: string[] = [];
  const end = dataEndIndex !== undefined ? Math.min(rows.length, dataEndIndex) : rows.length;

  for (let i = dataStartIndex; i < end; i++) {
    const row = rows[i];
    if (!row) continue;
    const val = row[columnIndex]?.trim();
    if (val && !samples.includes(val)) {
      samples.push(val);
      if (samples.length >= maxSamples) break;
    }
  }

  return samples;
}

export type PlannedMetricTranslationSummary = {
  destinationPeriodName: string;
  reusedExistingMetricsCount: number;
  attachedLibraryMetricsCount: number;
  createdMetricsCount: number;
  skippedColumnsCount: number;
  unsupportedColumnsCount: number;
  emptyColumnsCount: number;
  matchedMembersCount: number;
  totalEntriesCount: number;
};

export type CommittedMetricTranslationSummary = {
  destinationPeriodName: string;
  reusedMetrics: { metricId: string; name: string }[];
  attachedMetrics: { metricId: string; name: string }[];
  createdMetrics: { metricId: string; name: string }[];
  totalValuesCommitted: number;
  perMetricCounts: { metricId: string; name: string; count: number }[];
};

export type PlannedMultiPeriodTranslationSummary = {
  targetPeriodCount: number;
  totalEntriesCount: number;
  matchedMembersCount: number;
  periods: {
    periodId: string;
    periodName: string;
    mappedColumnsCount: number;
    totalEntriesCount: number;
  }[];
};

export type CommittedMultiPeriodTranslationSummary = {
  totalValuesCommitted: number;
  periods: CommittedMetricTranslationSummary[];
};

export type PlannedRosterTranslationSummary = {
  membersToCreateCount: number;
  archivedMembersToRestoreCount: number;
  existingActiveMembersUnchangedCount: number;
  unsupportedColumnsCount: number;
  emptyColumnsCount: number;
  totalRowsProcessed: number;
};

export type CommittedRosterTranslationSummary = {
  createdCount: number;
  restoredCount: number;
  skippedExistingCount: number;
  skippedDuplicatesCount: number;
  skippedEmptyNamesCount: number;
  skippedUnselectedCount: number;
  errors: string[];
};

export function buildPlannedMetricTranslationSummary(params: {
  periodName: string;
  translations: ColumnTranslation[];
  matchedMembersCount: number;
  totalEntriesCount: number;
}): PlannedMetricTranslationSummary {
  const { periodName, translations, matchedMembersCount, totalEntriesCount } = params;

  let reusedExistingMetricsCount = 0;
  let attachedLibraryMetricsCount = 0;
  let createdMetricsCount = 0;
  let skippedColumnsCount = 0;
  let unsupportedColumnsCount = 0;
  let emptyColumnsCount = 0;

  for (const t of translations) {
    if (t.kind === "metric") {
      if (t.target.kind === "existing") reusedExistingMetricsCount++;
      else if (t.target.kind === "attach") attachedLibraryMetricsCount++;
      else if (t.target.kind === "create") createdMetricsCount++;
      else if (t.target.kind === "skip") skippedColumnsCount++;
    } else if (t.kind === "unsupported") {
      unsupportedColumnsCount++;
    } else if (t.kind === "empty") {
      emptyColumnsCount++;
    }
  }

  return {
    destinationPeriodName: periodName,
    reusedExistingMetricsCount,
    attachedLibraryMetricsCount,
    createdMetricsCount,
    skippedColumnsCount,
    unsupportedColumnsCount,
    emptyColumnsCount,
    matchedMembersCount,
    totalEntriesCount,
  };
}

export function buildCommittedMetricTranslationSummary(params: {
  periodName: string;
  result: {
    success: boolean;
    totalCount: number;
    perMetric: { metricId: string; name: string; count: number }[];
    created: { metricId: string; name: string }[];
    attached: { metricId: string; name: string }[];
    reused: { metricId: string; name: string }[];
  };
}): CommittedMetricTranslationSummary {
  const { periodName, result } = params;
  return {
    destinationPeriodName: periodName,
    reusedMetrics: result.reused ?? [],
    attachedMetrics: result.attached ?? [],
    createdMetrics: result.created ?? [],
    totalValuesCommitted: result.totalCount,
    perMetricCounts: result.perMetric ?? [],
  };
}

export function buildPlannedMultiPeriodTranslationSummary(params: {
  matchedMembersCount: number;
  periods: PlannedMultiPeriodTranslationSummary["periods"];
}): PlannedMultiPeriodTranslationSummary {
  return {
    targetPeriodCount: params.periods.length,
    totalEntriesCount: params.periods.reduce((sum, p) => sum + p.totalEntriesCount, 0),
    matchedMembersCount: params.matchedMembersCount,
    periods: params.periods,
  };
}

export function buildCommittedMultiPeriodTranslationSummary(params: {
  result: {
    totalCount: number;
    periods: {
      periodId: string;
      periodName: string;
      totalCount: number;
      perMetric: { metricId: string; name: string; count: number }[];
      created: { metricId: string; name: string }[];
      attached: { metricId: string; name: string }[];
      reused: { metricId: string; name: string }[];
    }[];
  };
}): CommittedMultiPeriodTranslationSummary {
  return {
    totalValuesCommitted: params.result.totalCount,
    periods: params.result.periods.map((period) =>
      buildCommittedMetricTranslationSummary({
        periodName: period.periodName,
        result: {
          success: true,
          totalCount: period.totalCount,
          perMetric: period.perMetric,
          created: period.created,
          attached: period.attached,
          reused: period.reused,
        },
      }),
    ),
  };
}

export function buildPlannedRosterTranslationSummary(params: {
  membersToCreateCount: number;
  archivedMembersToRestoreCount: number;
  existingActiveMembersUnchangedCount: number;
  unsupportedColumnsCount: number;
  emptyColumnsCount: number;
  totalRowsProcessed: number;
}): PlannedRosterTranslationSummary {
  return params;
}

export function buildCommittedRosterTranslationSummary(params: {
  result: {
    created: number;
    restored: number;
    skippedExisting: number;
    skippedDuplicates: number;
    skippedEmptyNames: number;
    skippedUnselected: number;
    errors: string[];
  };
}): CommittedRosterTranslationSummary {
  const { result } = params;
  return {
    createdCount: result.created,
    restoredCount: result.restored,
    skippedExistingCount: result.skippedExisting,
    skippedDuplicatesCount: result.skippedDuplicates,
    skippedEmptyNamesCount: result.skippedEmptyNames,
    skippedUnselectedCount: result.skippedUnselected,
    errors: result.errors ?? [],
  };
}
