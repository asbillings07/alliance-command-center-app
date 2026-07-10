"use client";

import { useState, useTransition, useRef } from "react";
import { Metric_Type } from "@/app/generated/prisma/enums";
import { createMetric, editMetric } from "./action";

type MetricFormProps = {
  allianceId: string;
  mode: "create" | "edit";
  metricId?: string;
  name?: string;
  description?: string;
  type?: Metric_Type;
  onCancel: () => void;
};

export function MetricForm({
  allianceId,
  mode,
  metricId,
  name = "",
  description = "",
  type = Metric_Type.NUMERIC,
  onCancel,
}: MetricFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitLabel = mode === "create" ? "Create Metric" : "Update Metric";
  const pendingLabel = mode === "create" ? "Creating..." : "Updating...";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;

    setError(null);
    const formData = new FormData(formRef.current);

    startTransition(async () => {
      const action = mode === "create" ? createMetric : editMetric;
      const result = await action(formData);

      if (result.error) {
        setError(result.error);
      } else {
        onCancel();
      }
    });
  };

  return (
    <form
      ref={formRef}
      className="w-full rounded-md border p-4 shadow-sm flex flex-col gap-3 max-w-3xl"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="allianceId" value={allianceId} />
      {mode === "edit" && metricId && (
        <input type="hidden" name="metricId" value={metricId} />
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={name}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
          placeholder="e.g., VS Score"
          required
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Description (optional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
          placeholder="Describe what this metric measures..."
          defaultValue={description}
        />
      </div>

      <div>
        <label
          htmlFor="type"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Type
        </label>
        <select
          id="type"
          name="type"
          defaultValue={type}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
        >
          <option value={Metric_Type.NUMERIC}>Numeric</option>
          <option value={Metric_Type.BOOLEAN}>Boolean</option>
        </select>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
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
  );
}
