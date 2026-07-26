import type { MatchSummary } from "@/app/src/lib/memberMatcher";
import type {
  SkippedBlankCell,
  InvalidValueIssue,
  MissingIdentityIssue,
} from "@/app/src/lib/memberMatcher";
import type { ColumnTarget } from "@/app/src/lib/importTranslation";

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
