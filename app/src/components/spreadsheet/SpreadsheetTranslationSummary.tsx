"use client";

import type {
  PlannedMetricTranslationSummary,
  CommittedMetricTranslationSummary,
  PlannedRosterTranslationSummary,
  CommittedRosterTranslationSummary,
} from "@/app/src/lib/importTranslation";

type SpreadsheetTranslationSummaryProps =
  | {
      mode: "planned_metrics";
      summary: PlannedMetricTranslationSummary;
    }
  | {
      mode: "committed_metrics";
      summary: CommittedMetricTranslationSummary;
    }
  | {
      mode: "planned_roster";
      summary: PlannedRosterTranslationSummary;
    }
  | {
      mode: "committed_roster";
      summary: CommittedRosterTranslationSummary;
    };

export function SpreadsheetTranslationSummary(props: SpreadsheetTranslationSummaryProps) {
  if (props.mode === "planned_metrics") {
    const { summary } = props;
    return (
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center space-x-2">
            <span className="text-primary font-bold text-base">🔍</span>
            <div>
              <h4 className="font-semibold text-text-primary text-sm">Planned Metric Translation</h4>
              <p className="text-[11px] text-text-muted">
                Provisional translation summary — <strong>no database changes have been saved</strong>.
              </p>
            </div>
          </div>
          <span className="bg-primary/10 text-primary-light font-medium px-2 py-0.5 rounded text-[11px]">
            Destination: {summary.destinationPeriodName}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Matched Members</span>
            <span className="text-lg font-bold text-text-primary">{summary.matchedMembersCount}</span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Total Metric Entries</span>
            <span className="text-lg font-bold text-text-primary">{summary.totalEntriesCount}</span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Existing / Attached Metrics</span>
            <span className="text-lg font-bold text-success-light">
              {summary.reusedExistingMetricsCount + summary.attachedLibraryMetricsCount}
            </span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">New Metrics to Create</span>
            <span className="text-lg font-bold text-primary">
              {summary.createdMetricsCount}
            </span>
          </div>
        </div>

        {(summary.skippedColumnsCount > 0 ||
          summary.unsupportedColumnsCount > 0 ||
          summary.emptyColumnsCount > 0) && (
          <div className="text-[11px] text-text-muted flex flex-wrap gap-x-4 gap-y-1 bg-surface-secondary/20 p-2 rounded border border-border/30">
            <span>Skipped Columns: {summary.skippedColumnsCount}</span>
            <span>Excluded Unsupported: {summary.unsupportedColumnsCount}</span>
            <span>Ignored Empty: {summary.emptyColumnsCount}</span>
          </div>
        )}
      </div>
    );
  }

  if (props.mode === "committed_metrics") {
    const { summary } = props;
    return (
      <div className="bg-surface border border-success/30 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center space-x-2">
            <span className="text-success-light font-bold text-base">✅</span>
            <div>
              <h4 className="font-semibold text-text-primary text-sm">Committed Metric Translation</h4>
              <p className="text-[11px] text-success-light font-medium">
                Successfully saved metric entries to database.
              </p>
            </div>
          </div>
          <span className="bg-success/10 text-success-light font-medium px-2 py-0.5 rounded text-[11px]">
            Period: {summary.destinationPeriodName}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
          <div className="bg-success/10 p-2.5 rounded-lg border border-success/20">
            <span className="text-text-muted block">Total Entries Committed</span>
            <span className="text-xl font-bold text-success-light">
              {summary.totalValuesCommitted}
            </span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Reused / Attached Metrics</span>
            <span className="text-lg font-bold text-text-primary">
              {summary.reusedMetrics.length + summary.attachedMetrics.length}
            </span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">New Metrics Created</span>
            <span className="text-lg font-bold text-text-primary">
              {summary.createdMetrics.length}
            </span>
          </div>
        </div>

        {summary.perMetricCounts.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <h5 className="font-medium text-[11px] text-text-primary">Entries by Metric:</h5>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {summary.perMetricCounts.map((m) => (
                <span
                  key={m.metricId}
                  className="bg-surface-secondary/60 px-2 py-1 rounded border border-border/40 text-text-primary font-mono"
                >
                  {m.name}: <strong>{m.count}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (props.mode === "planned_roster") {
    const { summary } = props;
    return (
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center space-x-2">
            <span className="text-primary font-bold text-base">🔍</span>
            <div>
              <h4 className="font-semibold text-text-primary text-sm">Planned Alliance Member Translation</h4>
              <p className="text-[11px] text-text-muted">
                Provisional translation summary — <strong>no roster changes have been saved</strong>.
              </p>
            </div>
          </div>
          <span className="bg-primary/10 text-primary-light font-medium px-2 py-0.5 rounded text-[11px]">
            Scope: Alliance Members
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Members to Create</span>
            <span className="text-lg font-bold text-success-light">
              {summary.membersToCreateCount}
            </span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Archived to Restore</span>
            <span className="text-lg font-bold text-primary">
              {summary.archivedMembersToRestoreCount}
            </span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Active Members Unchanged</span>
            <span className="text-lg font-bold text-text-muted">
              {summary.existingActiveMembersUnchangedCount}
            </span>
          </div>
          <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
            <span className="text-text-muted block">Total Rows Processed</span>
            <span className="text-lg font-bold text-text-primary">{summary.totalRowsProcessed}</span>
          </div>
        </div>

        {(summary.unsupportedColumnsCount > 0 || summary.emptyColumnsCount > 0) && (
          <div className="text-[11px] text-text-muted flex flex-wrap gap-x-4 gap-y-1 bg-surface-secondary/20 p-2 rounded border border-border/30">
            <span>Excluded Unsupported Columns: {summary.unsupportedColumnsCount}</span>
            <span>Ignored Empty Columns: {summary.emptyColumnsCount}</span>
          </div>
        )}
      </div>
    );
  }

  // committed_roster
  const { summary } = props;
  return (
    <div className="bg-surface border border-success/30 rounded-xl p-4 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center space-x-2">
          <span className="text-success-light font-bold text-base">✅</span>
          <div>
            <h4 className="font-semibold text-text-primary text-sm">Committed Alliance Member Translation</h4>
            <p className="text-[11px] text-success-light font-medium">
              Successfully updated alliance members.
            </p>
          </div>
        </div>
        <span className="bg-success/10 text-success-light font-medium px-2 py-0.5 rounded text-[11px]">
          Scope: Alliance Members
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
        <div className="bg-success/10 p-2.5 rounded-lg border border-success/20">
          <span className="text-text-muted block">New Members Created</span>
          <span className="text-xl font-bold text-success-light">
            {summary.createdCount}
          </span>
        </div>
        <div className="bg-primary/10 p-2.5 rounded-lg border border-primary/20">
          <span className="text-text-muted block">Archived Members Restored</span>
          <span className="text-xl font-bold text-primary">
            {summary.restoredCount}
          </span>
        </div>
        <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
          <span className="text-text-muted block">Active Members Unchanged</span>
          <span className="text-lg font-bold text-text-muted">
            {summary.skippedExistingCount}
          </span>
        </div>
        <div className="bg-surface-secondary/40 p-2.5 rounded-lg border border-border/40">
          <span className="text-text-muted block">Skipped / Duplicates</span>
          <span className="text-lg font-bold text-text-muted">
            {summary.skippedDuplicatesCount + summary.skippedUnselectedCount}
          </span>
        </div>
      </div>
    </div>
  );
}
