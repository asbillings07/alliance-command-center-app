"use client";

import type { ColumnTranslation, ColumnTarget } from "@/app/src/lib/importTranslation";
import { columnIndexToLabel } from "@/app/src/lib/memberMatcher";

type ColumnTranslationCardProps = {
  translation: ColumnTranslation;
  metricOptions?: { id: string; name: string }[];
  libraryMetricOptions?: { id: string; name: string }[];
  canCreateMetrics?: boolean;
  canAttachMetrics?: boolean;
  onTargetChange?: (columnIndex: number, target: ColumnTarget) => void;
  onConfirmMetric?: (columnIndex: number) => void;
  onConfirmSkip?: (columnIndex: number) => void;
};

export function ColumnTranslationCard({
  translation,
  metricOptions = [],
  libraryMetricOptions = [],
  canCreateMetrics = true,
  canAttachMetrics = true,
  onTargetChange,
  onConfirmMetric,
  onConfirmSkip,
}: ColumnTranslationCardProps) {
  const colLetter = columnIndexToLabel(translation.columnIndex);

  return (
    <div className="bg-surface border border-border rounded-lg p-3 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-mono bg-surface-secondary text-text-muted px-1.5 py-0.5 rounded font-semibold text-[11px]">
              Column {colLetter}
            </span>
            <span className="font-semibold text-text-primary text-sm">
              &quot;{translation.sourceColumnName}&quot;
            </span>
          </div>

          {/* Sample values */}
          <div className="text-text-muted text-[11px] flex items-center space-x-1">
            <span className="font-medium text-text-primary/80">Samples:</span>
            {translation.samples.length > 0 ? (
              <span className="font-mono bg-surface-secondary/40 px-1.5 py-0.5 rounded border border-border/40">
                {translation.samples.map((s) => `"${s}"`).join(", ")}
              </span>
            ) : (
              <span className="italic text-text-muted/60">(none / empty column)</span>
            )}
          </div>
        </div>

        {/* Translation Status Badge */}
        <div>
          {translation.kind === "identity" && (
            <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
              Mapped: Member Identity
            </span>
          )}
          {translation.kind === "member_property" && (
            <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
              Mapped: {translation.targetLabel}
            </span>
          )}
          {translation.kind === "unsupported" && (
            <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
              Excluded: {translation.reason}
            </span>
          )}
          {translation.kind === "empty" && (
            <span className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
              Ignored: {translation.reason}
            </span>
          )}
          {translation.kind === "metric" && (
            <div>
              {translation.target.kind === "skip" ? (
                <span className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
                  Skipped
                </span>
              ) : translation.target.kind === "existing" ? (
                <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
                  Mapped: Existing Metric
                </span>
              ) : translation.target.kind === "attach" ? (
                <span className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
                  Mapped: Library Metric
                </span>
              ) : (
                <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-medium text-[11px]">
                  Mapped: New Metric
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Metric configuration / confirmation controls */}
      {translation.kind === "metric" && (
        <div className="pt-1 border-t border-border/40 space-y-2">
          {translation.classification.intent === "likely_period" && (
            <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded text-[11px] space-y-1.5">
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                Period-like Column Detected (&quot;{translation.sourceColumnName}&quot;)
              </p>
              <p className="text-amber-800/80 dark:text-amber-200/80">
                This header resembles an evaluation period name. Single-period import imports metrics into the selected destination period.
              </p>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => onConfirmMetric?.(translation.columnIndex)}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  Keep as Metric Name
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmSkip?.(translation.columnIndex)}
                  className="px-2.5 py-1 bg-surface-secondary text-text-primary hover:bg-surface-secondary/80 rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  Skip Column
                </button>
              </div>
            </div>
          )}

          {translation.classification.intent === "unsure" && (
            <div className="bg-slate-500/10 border border-slate-500/20 p-2 rounded text-[11px] space-y-1.5">
              <p className="font-semibold text-text-primary">
                Ambiguous Column Header (&quot;{translation.sourceColumnName}&quot;)
              </p>
              <p className="text-text-muted">
                This header does not match known metrics or library metrics. Please choose whether to import this as a metric or skip it.
              </p>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => onConfirmMetric?.(translation.columnIndex)}
                  className="px-2.5 py-1 bg-primary text-white hover:bg-primary-hover rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  Import as Metric
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmSkip?.(translation.columnIndex)}
                  className="px-2.5 py-1 bg-surface-secondary text-text-primary hover:bg-surface-secondary/80 rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  Skip Column
                </button>
              </div>
            </div>
          )}

          {/* Action selection dropdowns if confirmed or likely_metric */}
          {translation.confirmationStatus !== "unconfirmed" && onTargetChange && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="text-text-muted font-medium">Action:</label>
              <select
                value={
                  translation.target.kind === "skip"
                    ? "skip"
                    : translation.target.kind === "existing"
                    ? `existing:${translation.target.metricId}`
                    : translation.target.kind === "attach"
                    ? `attach:${translation.target.metricId}`
                    : "create"
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "skip") {
                    onTargetChange(translation.columnIndex, { kind: "skip" });
                  } else if (val === "create") {
                    onTargetChange(translation.columnIndex, {
                      kind: "create",
                      name: translation.sourceColumnName,
                    });
                  } else if (val.startsWith("existing:")) {
                    onTargetChange(translation.columnIndex, {
                      kind: "existing",
                      metricId: val.replace("existing:", ""),
                    });
                  } else if (val.startsWith("attach:")) {
                    onTargetChange(translation.columnIndex, {
                      kind: "attach",
                      metricId: val.replace("attach:", ""),
                    });
                  }
                }}
                className="px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="skip">Skip column</option>

                {metricOptions.length > 0 && (
                  <optgroup label="Map to Existing Period Metric">
                    {metricOptions.map((m) => (
                      <option key={m.id} value={`existing:${m.id}`}>
                        Map to &quot;{m.name}&quot;
                      </option>
                    ))}
                  </optgroup>
                )}

                {canAttachMetrics && libraryMetricOptions.length > 0 && (
                  <optgroup label="Attach Library Metric">
                    {libraryMetricOptions.map((m) => (
                      <option key={m.id} value={`attach:${m.id}`}>
                        Attach &quot;{m.name}&quot;
                      </option>
                    ))}
                  </optgroup>
                )}

                {canCreateMetrics && (
                  <option value="create">
                    Create new metric &quot;{translation.sourceColumnName}&quot;
                  </option>
                )}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
