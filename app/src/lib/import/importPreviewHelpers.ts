import type { MatchResult, MatchSummary } from "@/app/src/lib/memberMatcher";
import type {
  SkippedBlankCell,
  InvalidValueIssue,
  MissingIdentityIssue,
} from "@/app/src/lib/memberMatcher";
import type { ColumnTarget, ColumnTranslation } from "@/app/src/lib/importTranslation";

export type MetricDisposition = "existing" | "attach" | "create";

export type MetricImportPreviewData = {
  columnIndex: number;
  columnName: string;
  displayName: string;
  proposedMetricName: string;
  disposition: MetricDisposition;
  target: ColumnTarget;
  summary: MatchSummary;
  skippedBlankCells: SkippedBlankCell[];
  invalidValueIssues: InvalidValueIssue[];
  missingIdentityIssues: MissingIdentityIssue[];
};

export function getPreviewEntries(
  preview: MetricImportPreviewData,
  selections: Record<string, number> | undefined,
): { memberId: string; rawValue: string }[] {
  const selectedIndices = new Set(Object.values(selections ?? {}));
  return preview.summary.results
    .filter((result, index): result is typeof result & { memberId: string; rawValue: string } => {
      if (!result.memberId || result.status === "invalid_value" || !result.rawValue) return false;
      return selectedIndices.has(index);
    })
    .map((r) => ({ memberId: r.memberId, rawValue: r.rawValue }));
}

export function dispositionForTarget(target: ColumnTarget): MetricDisposition {
  if (target.kind === "skip") return "existing";
  return target.kind;
}

export type MetricPreviewStatus = "ready" | "needs_review";

export type MetricPreviewCounts = {
  importableCount: number;
  unmatchedCount: number;
  invalidCount: number;
  status: MetricPreviewStatus;
};

export function columnTranslationRequiresAction(translation: ColumnTranslation): boolean {
  return translation.kind === "metric" && translation.confirmationStatus === "unconfirmed";
}

export function shouldSourceColumnTranslationsDefaultOpen(translations: ColumnTranslation[]): boolean {
  return translations.some(columnTranslationRequiresAction);
}

export function getMetricPreviewCounts(
  preview: MetricImportPreviewData,
  selections: Record<string, number> | undefined,
): MetricPreviewCounts {
  const importableCount = getPreviewEntries(preview, selections).length;
  const unmatchedCount = preview.summary.unmatched;
  const invalidCount = preview.summary.results.filter((result) => result.status === "invalid_value").length;
  const needsReview =
    unmatchedCount > 0 || invalidCount > 0 || preview.summary.duplicates > 0;

  return {
    importableCount,
    unmatchedCount,
    invalidCount,
    status: needsReview ? "needs_review" : "ready",
  };
}

/** Index in `previews` of the metric leaders should review first (first needs_review, else 0). */
export function getDefaultActiveMetricIndex(
  previews: MetricImportPreviewData[],
  selectionsByColumn: Record<number, Record<string, number> | undefined>,
): number {
  for (let index = 0; index < previews.length; index++) {
    const preview = previews[index];
    const { status } = getMetricPreviewCounts(preview, selectionsByColumn[preview.columnIndex]);
    if (status === "needs_review") return index;
  }
  return 0;
}

export function getMetricIndicesNeedingReview(
  previews: MetricImportPreviewData[],
  selectionsByColumn: Record<number, Record<string, number> | undefined>,
): number[] {
  return previews.reduce<number[]>((indices, preview, index) => {
    const { status } = getMetricPreviewCounts(preview, selectionsByColumn[preview.columnIndex]);
    if (status === "needs_review") indices.push(index);
    return indices;
  }, []);
}

export type PreviewRowOutcome = "needs_attention" | "will_import";

export function getMembersWithDuplicateRows(summary: MatchSummary): Set<string> {
  const duplicateCounts = new Map<string, number>();
  for (const result of summary.results) {
    if (result.memberId) {
      duplicateCounts.set(result.memberId, (duplicateCounts.get(result.memberId) || 0) + 1);
    }
  }
  const duplicates = new Set<string>();
  for (const [memberId, count] of duplicateCounts) {
    if (count > 1) duplicates.add(memberId);
  }
  return duplicates;
}

export function classifyPreviewRow(
  result: MatchResult,
  resultIndex: number,
  membersWithDuplicates: Set<string>,
  selections: Record<string, number> | undefined,
): PreviewRowOutcome {
  if (result.status === "unmatched" || result.status === "invalid_value") {
    return "needs_attention";
  }

  const isSelected = result.memberId ? selections?.[result.memberId] === resultIndex : false;
  const memberHasDuplicates = result.memberId ? membersWithDuplicates.has(result.memberId) : false;

  if (memberHasDuplicates && !isSelected) {
    return "needs_attention";
  }

  if (isSelected) {
    return "will_import";
  }

  return "needs_attention";
}

export type MetricRowGroups = {
  needsAttention: number[];
  willImport: number[];
};

/** Partition `summary.results` indices into outcome groups. Skipped blanks live outside `results`. */
export function groupMetricRowsByOutcome(
  preview: MetricImportPreviewData,
  selections: Record<string, number> | undefined,
): MetricRowGroups {
  const membersWithDuplicates = getMembersWithDuplicateRows(preview.summary);
  const needsAttention: number[] = [];
  const willImport: number[] = [];

  preview.summary.results.forEach((result, index) => {
    const outcome = classifyPreviewRow(result, index, membersWithDuplicates, selections);
    if (outcome === "needs_attention") {
      needsAttention.push(index);
    } else {
      willImport.push(index);
    }
  });

  return { needsAttention, willImport };
}
