'use client'
import { Metric } from "@/app/generated/prisma/client";
import { PeriodMetricForm } from "./PeriodMetricForm";

type PeriodMetricData = {
    metricId: string;
    metricName: string;
    weight: number;
    required: boolean;
};

type PeriodMetricListProps = {
    metrics: Pick<Metric, "id" | "name">[];
    periodId: string;
    periodMetrics: PeriodMetricData[];
};

export function PeriodMetricList({ metrics, periodId, periodMetrics }: PeriodMetricListProps) {
    return (
        <div className="flex flex-col gap-4 w-full max-w-md items-center">
            {periodMetrics.length === 0 ? (
                <p className="text-gray-500">No metrics have been configured yet. Add the metrics you want leaders to evaluate during this period.</p>
            ) : (
                <ul className="flex flex-col gap-2 w-full">
                    {periodMetrics.map((pm) => (
                        <li key={pm.metricId} className="flex items-center justify-between p-3 border rounded-md">
                            <span className="font-medium">{pm.metricName}</span>
                            <div className="flex items-center gap-3 text-sm">
                                {pm.required && (
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                        Required
                                    </span>
                                )}
                                <span className="text-gray-600">Weight: {pm.weight}</span>
                                <PeriodMetricForm
                                    metrics={metrics}
                                    periodId={periodId}
                                    mode="edit"
                                    metricId={pm.metricId}
                                    metricName={pm.metricName}
                                    weight={pm.weight}
                                    required={pm.required}
                                    onClose={() => {}}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <PeriodMetricForm
                metrics={metrics}
                periodId={periodId}
                mode="create"
                onClose={() => {}}
            />
        </div>
    );
}
