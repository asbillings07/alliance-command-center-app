"use client";

import type { PeriodMappingReview } from "@/app/src/lib/import/periodProposal";

type PeriodProposalReviewProps = {
  review: PeriodMappingReview;
  destinationPeriodName: string;
  onDecline: () => void;
  onAcceptReview?: () => void;
};

export function PeriodProposalReview({
  review,
  destinationPeriodName,
  onDecline,
  onAcceptReview,
}: PeriodProposalReviewProps) {
  if (review.mode !== "multi_period" || review.proposals.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-xs space-y-4 shadow-sm">
      <div className="flex items-start justify-between border-b border-border pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-blue-500 font-bold text-lg">📅</span>
          <div>
            <h4 className="font-semibold text-text-primary text-sm">
              Multi-Period Spreadsheet Detected
            </h4>
            <p className="text-[11px] text-text-muted mt-0.5">
              Worksheet &quot;{review.sheetName}&quot; appears to contain date-stamped metric results for multiple periods.
            </p>
          </div>
        </div>
        <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium px-2.5 py-1 rounded text-[11px]">
          {review.proposals.length} Proposed Period{review.proposals.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="bg-surface-secondary/40 p-3 rounded-lg border border-border/40 space-y-1 text-[11px]">
        <p className="font-medium text-text-primary">{review.evidenceSummary}</p>
        <p className="text-text-muted">
          ACC suggests what the spreadsheet means, but leaders decide what it becomes. No changes are saved to the database during proposal review.
        </p>
      </div>

      {/* Proposal Cards List */}
      <div className="space-y-3">
        {review.proposals.map((prop) => (
          <div
            key={prop.proposalId}
            className="bg-surface-secondary/20 border border-border/60 rounded-lg p-3 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-text-primary text-sm">
                  {prop.proposedPeriodName}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                    prop.dateKind === "snapshot"
                      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  }`}
                >
                  {prop.dateKind === "snapshot" ? "Snapshot (Single Date)" : "Range (Window)"}
                </span>
              </div>
              <span className="text-[11px] font-mono text-text-muted">
                {prop.startsAtISO === prop.endsAtISO
                  ? prop.startsAtISO
                  : `${prop.startsAtISO} to ${prop.endsAtISO}`}
              </span>
            </div>

            {/* Mapped columns */}
            <div className="space-y-1 pt-1">
              <span className="text-[11px] text-text-muted font-medium block">
                Proposed Metric Columns ({prop.columns.length}):
              </span>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {prop.columns.map((col) => (
                  <span
                    key={col.columnIndex}
                    className="bg-surface-secondary px-2 py-0.5 rounded border border-border/40 text-text-primary font-mono"
                  >
                    &quot;{col.headerText}&quot; → <strong>{col.proposedMetricName}</strong>
                  </span>
                ))}
              </div>
            </div>

            {/* Warnings */}
            {prop.warnings.length > 0 && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20 space-y-0.5">
                {prop.warnings.map((w, idx) => (
                  <p key={idx}>⚠️ {w}</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Derived columns notice */}
      {review.hasDerivedColumns && (
        <div className="bg-surface-secondary/30 p-2.5 rounded-lg border border-border/30 text-[11px] text-text-muted">
          ℹ️ {review.excludedDerivedColumnsCount} derived column{review.excludedDerivedColumnsCount === 1 ? "" : "s"} (% change, rank, delta) were detected and excluded by default.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
        <p className="text-[11px] text-text-muted">
          Want to import into <strong>{destinationPeriodName}</strong> instead?
        </p>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onDecline}
            className="px-3 py-1.5 bg-surface-secondary text-text-primary hover:bg-surface-secondary/80 border border-border rounded-md font-medium transition-colors cursor-pointer"
          >
            Decline & Use Selected Period Instead
          </button>
          {onAcceptReview && (
            <button
              type="button"
              onClick={onAcceptReview}
              className="px-3 py-1.5 bg-primary text-white hover:bg-primary-hover rounded-md font-medium transition-colors cursor-pointer"
            >
              Review Multi-Period Mappings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
