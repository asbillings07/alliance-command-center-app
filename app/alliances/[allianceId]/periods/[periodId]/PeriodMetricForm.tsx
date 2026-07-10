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
          className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
          onClick={openDialog}
        >
          Add Metric
        </button>
      ) : (
        <button
          className="text-sm text-blue-500 hover:text-blue-700 cursor-pointer"
          onClick={openDialog}
        >
          Edit
        </button>
      )}

      <dialog
        ref={dialogRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-0 backdrop:bg-black/50 max-w-md w-full m-0"
      >
        <form
          ref={formRef}
          className="p-6 flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="allianceId" value={allianceId} />
          <h2 className="text-lg font-semibold">{title}</h2>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {mode === "create" ? (
            <div>
              <label
                htmlFor="metricId"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Metric
              </label>
              <select
                name="metricId"
                id="metricId"
                disabled={isPending}
                className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Metric
              </label>
              <p className="text-gray-900 font-medium">{metricName}</p>
            </div>
          )}

          <div>
            <label
              htmlFor="weight"
              className="block text-sm font-medium text-gray-700 mb-1"
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
              className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
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
              className="rounded border-gray-300"
            />
            <label htmlFor="required" className="text-sm text-gray-700">
              Required
            </label>
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={isPending}
              className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? pendingLabel : submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
