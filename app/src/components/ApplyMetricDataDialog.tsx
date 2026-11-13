"use client";

import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

export type MetricApplicationSummary = {
  periodName: string;
  metricName: string;
  entryCount: number;
};

type ApplyMetricDataDialogProps = Pick<ConfirmDialogProps, "isOpen" | "onConfirm" | "onClose"> & {
  summary: MetricApplicationSummary[];
};

/** The final apply step shared by manual entry and reviewed spreadsheet imports. */
export function ApplyMetricDataDialog({ summary, ...props }: ApplyMetricDataDialogProps) {
  const entryCount = summary.reduce((count, item) => count + item.entryCount, 0);
  return (
    <ConfirmDialog
      {...props}
      title="Apply this data?"
      confirmLabel="Yes, apply data"
      pendingLabel="Applying…"
      confirmDisabled={entryCount === 0}
      description={
        <div className="space-y-3 text-sm text-text-secondary">
          <p>Are you sure you want to apply this data? You are about to record {entryCount} {entryCount === 1 ? "entry" : "entries"}.</p>
          <ul aria-label="Data to apply" tabIndex={0} className="max-h-32 overflow-y-auto rounded-md border border-border p-3 space-y-2 focus-visible:outline-2 focus-visible:outline-primary">
            {summary.map((item, index) => (
              <li key={index}>
                <strong className="text-text-primary">{item.metricName}</strong>
                <span className="block">{item.periodName} · {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</span>
              </li>
            ))}
          </ul>
          <p>Check the member names, values and periods before continuing. Applying this data can change current results and reports.</p>
          <p>Earlier entries will remain in <strong>Go back in time</strong>, along with who recorded each new entry. Cancel to return to your review without applying anything.</p>
        </div>
      }
    />
  );
}
