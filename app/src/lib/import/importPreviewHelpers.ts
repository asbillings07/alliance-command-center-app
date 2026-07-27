import type { MatchSummary } from "@/app/src/lib/memberMatcher";
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
