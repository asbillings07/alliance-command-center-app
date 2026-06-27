
import type { Metric } from "@/app/generated/prisma/client";
import type { Metric_Type } from "@/app/generated/prisma/enums";

const METRIC_TYPE_LABELS:Record<Metric_Type, string> = {
    NUMERIC: "Numeric",
    BOOLEAN: "Boolean",
};

export const MetricCard = ({ metric }: { metric: Metric }) => {
    return (
        <div className="flex flex-col gap-2 border-2 border-gray-300 rounded-md p-5 max-w-3xl w-full">
            <h2 className="text-xl font-bold">Metric: {metric.name}</h2>
            {metric.description && (
                <p>Description: {metric.description}</p>
            )}
            <p>Type: {METRIC_TYPE_LABELS[metric.type]}</p>
            <div className="flex flex-row gap-2">
                <button className="text-sm text-blue-500 hover:text-blue-700 cursor-pointer">Edit</button>
                <button className="text-sm text-red-500 hover:text-red-700 cursor-pointer">Archive</button>
            </div>
        </div>
    )
}