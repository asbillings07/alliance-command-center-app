"use client";

import type { Metric } from "@/app/generated/prisma/client";
import { useRef, useState, useTransition } from "react";
import { addMetricToPeriod, editPeriodMetric } from "./action";

type PeriodMetricFormProps = {
  metrics: Pick<Metric, "id" | "name">[];
  periodId: string;
  allianceId: string;
  mode: "create" | "edit";
  metricId?: string;
  metricName?: string;
  weight?: number;
  required?: boolean;
  onClose: () => void;
};

export function PeriodMetricForm({
  metrics,
  periodId,
  allianceId,
  mode,
  metricId,
  metricName,
  weight = 0,
  required = false,
  onClose,
}: PeriodMetricFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setError(null);
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
    setError(null);
    onClose();
  };

  const title =
    mode === "create" ? "Add Metric to Period" : "Edit Period Metric";
  const submitLabel = mode === "create" ? "Add" : "Update";
  const pendingLabel = mode === "create" ? "Adding..." : "Updating...";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.append("periodId", periodId);
    if (mode === "edit" && metricId) {
      formData.append("metricId", metricId);
    }

    startTransition(async () => {
      const action = mode === "create" ? addMetricToPeriod : editPeriodMetric;
      const result = await action(formData);

      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        closeDialog();
      }
    });
  };

  return (
    <>
      {mode === "create" ? (
        <button
          className="px-4 py-2 rounded-md bg-primary-hover text-white hover:bg-primary cursor-pointer"
          onClick={openDialog}
        >
          Add Metric
        </button>
      ) : (
        <button
          className="text-sm text-primary-light hover:text-primary cursor-pointer"
          onClick={openDialog}
        >
          Edit
        </button>
      )}

      <dialog
        ref={dialogRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-0 backdrop:bg-black/50 max-w-md w-full m-0 bg-surface border border-border"
      >
        <form
          ref={formRef}
          className="p-6 flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="allianceId" value={allianceId} />
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>

          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger-light">
              {error}
            </div>
          )}

          {mode === "create" ? (
            <div>
              <label
                htmlFor="metricId"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                Metric
              </label>
              <select
                name="metricId"
                id="metricId"
                disabled={isPending}
                className="w-full rounded-md border border-border bg-surface-secondary p-2 text-text-primary disabled:bg-surface-secondary disabled:text-text-disabled"
                required
              >
                <option value="">Select a metric</option>
                {metrics.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {metric.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Metric
              </label>
              <p className="text-text-primary font-medium">{metricName}</p>
            </div>
          )}

          <div>
            <label
              htmlFor="weight"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Weight (0-100)
            </label>
            <input
              type="number"
              name="weight"
              id="weight"
              min="0"
              max="100"
              defaultValue={weight}
              disabled={isPending}
              className="w-full rounded-md border border-border bg-surface-secondary p-2 text-text-primary disabled:bg-surface-secondary disabled:text-text-disabled"
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="required"
              id="required"
              defaultChecked={required}
              disabled={isPending}
              className="rounded border-border"
            />
            <label htmlFor="required" className="text-sm text-text-secondary">
              Required
            </label>
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={isPending}
              className="px-4 py-2 rounded-md border border-border text-text-secondary hover:bg-surface-secondary cursor-pointer disabled:text-text-disabled disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 rounded-md bg-primary-hover text-white hover:bg-primary cursor-pointer disabled:bg-surface-secondary disabled:text-text-disabled disabled:cursor-not-allowed"
            >
              {isPending ? pendingLabel : submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
