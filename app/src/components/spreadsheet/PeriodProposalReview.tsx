"use client";

import {
  formatReviewableDateEvidence,
  type PeriodMappingReview,
  type ExcludedColumnEvidence,
  type ReviewableColumnEvidence,
} from "@/app/src/lib/import/periodProposal";

type PeriodProposalReviewProps = {
  review: PeriodMappingReview;
  destinationPeriodName: string;
  onDecline: () => void;
  onDismissSuggestion?: () => void;
  onAcceptReview?: () => void;
};

const CONFIDENCE_STYLES: Record<
  "high" | "medium" | "low",
  { label: string; className: string }
> = {
  high: {
    label: "High confidence",
    className: "bg-success/10 text-success border-success/30",
  },
  medium: {
    label: "Medium confidence",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  low: {
    label: "Low confidence",
    className: "bg-surface-secondary text-text-muted border-border",
  },
};

const EXCLUSION_REASON_LABELS: Record<
  ExcludedColumnEvidence["reason"],
  string
> = {
  derived: "Derived column",
  non_numeric: "Non-numeric column",
  no_date_evidence: "No date evidence",
  invalid_date: "Invalid calendar date",
  player_column: "Player column",
};

const REVIEWABLE_REASON_LABELS: Record<
  ReviewableColumnEvidence["reviewReason"],
  string
> = {
  unresolved_year: "Needs year confirmation",
  locale_ambiguous: "Ambiguous date order",
  range_chronology_conflict: "Range chronology conflict",
};

export function PeriodProposalReview({
  review,
  destinationPeriodName,
  onDecline,
  onDismissSuggestion,
  onAcceptReview,
}: PeriodProposalReviewProps) {
  const isBlocking = review.mode === "multi_period";
  const isSingleSuggestion = review.mode === "single_period_suggestion";
  const hasQualifyingProposals =
    review.proposals.length > 0 && (isBlocking || isSingleSuggestion);
  const hasReviewable = review.reviewableColumns.length > 0;

  if (!hasQualifyingProposals && !hasReviewable) {
    return null;
  }

  const qualifyingProposals = isBlocking || isSingleSuggestion ? review.proposals : [];

  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-xs space-y-4 shadow-sm">
      <div className="flex items-start justify-between border-b border-border pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-blue-500 font-bold text-lg">📅</span>
          <div>
            <h4 className="font-semibold text-text-primary text-sm">
              {isBlocking
                ? "Multi-Period Spreadsheet Detected"
                : isSingleSuggestion
                  ? "Single Evaluation Period Suggested"
                  : "Date Evidence Needs Confirmation"}
            </h4>
            <p className="text-[11px] text-text-muted mt-0.5">
              Worksheet &quot;{review.sheetName}&quot;
              {review.tableRegionId ? ` · region ${review.tableRegionId}` : ""}
              {" · "}
              header row {review.headerRowIndex + 1}
            </p>
          </div>
        </div>
        {qualifyingProposals.length > 0 && (
          <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium px-2.5 py-1 rounded text-[11px]">
            {qualifyingProposals.length} Confident Period
            {qualifyingProposals.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div
        className={`p-3 rounded-lg space-y-1 text-[11px] ${
          isBlocking
            ? "bg-amber-500/10 border border-amber-500/30"
            : "bg-surface-secondary/60 border border-border/40"
        }`}
      >
        <p className={isBlocking ? "font-medium text-amber-200" : "font-medium text-text-primary"}>
          {review.evidenceSummary}
        </p>
        {isBlocking ? (
          <p className="text-amber-300/90">
            ACC suggests what the spreadsheet means, but you decide what it becomes.
            The fixed-period import controls below are disabled until you explicitly
            choose how to proceed.
          </p>
        ) : isSingleSuggestion ? (
          <p className="text-text-secondary">
            This is informational only — you can continue importing into{" "}
            <strong>{destinationPeriodName}</strong> using the mapping controls below.
          </p>
        ) : (
          <p className="text-text-secondary">
            These columns contain date evidence but need leader confirmation before they
            can suggest concrete evaluation periods.
          </p>
        )}
      </div>

      {qualifyingProposals.length > 0 && (
        <div className="space-y-3">
          {qualifyingProposals.map((prop) => {
            const conf = CONFIDENCE_STYLES[prop.confidence];
            return (
              <div
                key={prop.proposalId}
                className="bg-surface-secondary/20 border border-border/60 rounded-lg p-3 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center space-x-2 flex-wrap gap-1">
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
                      {prop.dateKind === "snapshot" ? "Snapshot" : "Range"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${conf.className}`}
                    >
                      {conf.label}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-text-muted">
                    {prop.startsAtISO && prop.endsAtISO
                      ? prop.startsAtISO === prop.endsAtISO
                        ? prop.startsAtISO
                        : `${prop.startsAtISO} to ${prop.endsAtISO}`
                      : "Dates require year confirmation"}
                  </span>
                </div>

                <div className="space-y-1 pt-1">
                  <span className="text-[11px] text-text-muted font-medium block">
                    Proposed metric columns ({prop.columns.length}):
                  </span>
                  <ul className="space-y-1">
                    {prop.columns.map((col) => (
                      <li
                        key={col.columnIndex}
                        className="text-[11px] text-text-primary bg-surface-secondary/60 px-2 py-1 rounded border border-border/40"
                      >
                        <span className="font-mono text-text-muted">
                          {col.headerAddress ?? `col ${col.columnIndex + 1}`}
                        </span>
                        {" · "}
                        &quot;{col.headerText}&quot; → <strong>{col.proposedMetricName}</strong>
                        {col.hasTypedDateHeader && col.typedDateFormattedText && (
                          <span className="text-text-muted">
                            {" "}
                            (Excel typed date: {col.typedDateFormattedText})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {prop.warnings.length > 0 && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20 space-y-0.5">
                    {prop.warnings.map((w, idx) => (
                      <p key={idx}>⚠️ {w}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasReviewable && (
        <div className="bg-amber-500/5 p-3 rounded-lg border border-amber-500/20 space-y-2">
          <p className="text-[11px] font-medium text-text-primary">
            Columns needing confirmation ({review.reviewableColumns.length})
          </p>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {review.reviewableColumns.map((col) => (
              <li
                key={`${col.columnIndex}-${col.reviewReason}`}
                className="text-[11px] bg-surface-secondary/40 px-2 py-2 rounded border border-border/40"
              >
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-mono text-text-muted">
                    {col.headerAddress ?? `col ${col.columnIndex + 1}`}
                  </span>
                  <span className="text-text-muted">·</span>
                  <strong className="text-text-primary">&quot;{col.headerText}&quot;</strong>
                  <span className="text-text-muted">→ {col.proposedMetricName}</span>
                  <span className="px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px]">
                    {REVIEWABLE_REASON_LABELS[col.reviewReason]}
                  </span>
                </div>
                <p className="text-text-muted mt-1 pl-1">
                  Detected date: {formatReviewableDateEvidence(col.parsedDate)} — {col.detail}
                </p>
                {col.warnings.length > 0 && (
                  <ul className="mt-1 pl-3 space-y-0.5 text-text-muted">
                    {col.warnings.map((w, idx) => (
                      <li key={idx}>⚠️ {w}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.excludedColumns.length > 0 && (
        <div className="bg-surface-secondary/30 p-3 rounded-lg border border-border/40 space-y-2">
          <p className="text-[11px] font-medium text-text-primary">
            Excluded columns ({review.excludedColumns.length})
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {review.excludedColumns.map((col) => (
              <li
                key={`${col.columnIndex}-${col.reason}`}
                className="text-[11px] text-text-secondary flex flex-col gap-0.5 border-b border-border/30 last:border-0 pb-1 last:pb-0"
              >
                <span>
                  <span className="font-mono text-text-muted">
                    {col.headerAddress ?? `col ${col.columnIndex + 1}`}
                  </span>
                  {" · "}
                  <strong className="text-text-primary">&quot;{col.headerText}&quot;</strong>
                  {" · "}
                  <span className="text-text-muted">
                    {EXCLUSION_REASON_LABELS[col.reason]}
                    {col.derivedReason ? ` (${col.derivedReason})` : ""}
                  </span>
                </span>
                <span className="text-text-muted pl-2">{col.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isBlocking && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <p className="text-[11px] text-text-muted">
            To import into <strong>{destinationPeriodName}</strong> instead, explicitly decline this proposal review.
          </p>
          <button
            type="button"
            onClick={onDecline}
            className="px-3 py-1.5 bg-surface-secondary text-text-primary hover:bg-surface-secondary/80 border border-border rounded-md font-medium transition-colors cursor-pointer"
          >
            Decline & Use Selected Period Instead
          </button>
        </div>
      )}

      {isSingleSuggestion && onDismissSuggestion && (
        <div className="flex justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={onDismissSuggestion}
            className="px-3 py-1.5 bg-surface-secondary text-text-primary hover:bg-surface-secondary/80 border border-border rounded-md font-medium transition-colors cursor-pointer"
          >
            Dismiss Suggestion
          </button>
        </div>
      )}

      {onAcceptReview && isBlocking && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onAcceptReview}
            className="px-3 py-1.5 bg-primary text-white hover:bg-primary-hover rounded-md font-medium transition-colors cursor-pointer"
          >
            Review Multi-Period Mappings
          </button>
        </div>
      )}
    </div>
  );
}
