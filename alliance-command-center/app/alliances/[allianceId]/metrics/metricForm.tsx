'use client'
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
    const action = mode === "create" ? createMetric : editMetric;
    const submitLabel = mode === "create" ? "Create Metric" : "Update Metric";

    return (
        <form className="w-full rounded-md border p-4 shadow-sm flex flex-col gap-3 max-w-3xl" action={action}>
            <input type="hidden" name="allianceId" value={allianceId} />
            {mode === "edit" && metricId && <input type="hidden" name="metricId" value={metricId} />}

            <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                </label>
                <input
                    id="name"
                    name="name"
                    type="text"
                    defaultValue={name}
                    className="w-full rounded-md border border-gray-300 p-2"
                    placeholder="e.g., VS Score"
                    required
                />
            </div>

            <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                    Description (optional)
                </label>
                <textarea
                    id="description"
                    name="description"
                    rows={2}
                    className="w-full rounded-md border border-gray-300 p-2"
                    placeholder="Describe what this metric measures..."
                    defaultValue={description}
                />
            </div>

            <div>
                <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">
                    Type
                </label>
                <select
                    id="type"
                    name="type"
                    defaultValue={type}
                    className="w-full rounded-md border border-gray-300 p-2"
                >
                    <option value={Metric_Type.NUMERIC}>Numeric</option>
                    <option value={Metric_Type.BOOLEAN}>Boolean</option>
                </select>
            </div>

            <div className="flex gap-2 justify-end">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                >
                    {submitLabel}
                </button>
            </div>
        </form>
    );
}
