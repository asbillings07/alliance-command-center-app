'use client'
import type { Metric } from "@/app/generated/prisma/client";
import Link from "next/link";
import { PeriodMetricForm } from "./PeriodMetricForm";

type PeriodMetricData = {
    metricId: string;
    metricName: string;
    weight: number;
    required: boolean;
};

type PeriodMetricListProps = {
    metrics: Pick<Metric, "id" | "name">[];
    allianceId: string;
    periodId: string;
    periodMetrics: PeriodMetricData[];
    readOnly?: boolean;
};

export function PeriodMetricList({ metrics, periodId, allianceId, periodMetrics, readOnly = false }: PeriodMetricListProps) {
    const assignedMetricIds = new Set(periodMetrics.map((pm) => pm.metricId));
    const availableMetrics = metrics.filter((m) => !assignedMetricIds.has(m.id));

    if (readOnly) {
        return (
            <div className="flex flex-col gap-4 w-full max-w-md items-center">
                {periodMetrics.length === 0 ? (
                    <p className="text-text-muted">No metrics configured for this period.</p>
                ) : (
                    <ul className="flex flex-col gap-2 w-full">
                        {periodMetrics.map((pm) => (
                            <li key={pm.metricId} className="flex items-center justify-between p-3 border border-border rounded-md">
                                <span className="font-medium text-text-primary">{pm.metricName}</span>
                                <div className="flex items-center gap-3 text-sm">
                                    {pm.required && (
                                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-danger/20 text-danger-light">
                                            Required
                                        </span>
                                    )}
                                    <span className="text-text-secondary">Weight: {pm.weight}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 w-full max-w-md items-center">
            {periodMetrics.length === 0 ? (
                <p className="text-text-muted">No metrics have been configured yet. Add the metrics you want leaders to evaluate during this period.</p>
            ) : (
                <ul className="flex flex-col gap-2 w-full">
                    {periodMetrics.map((pm) => (
                        <li key={pm.metricId} className="flex items-center justify-between p-3 border border-border rounded-md">
                            <span className="font-medium text-text-primary">{pm.metricName}</span>
                            <div className="flex items-center gap-3 text-sm">
                                {pm.required && (
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-danger/20 text-danger-light">
                                        Required
                                    </span>
                                )}
                                <span className="text-text-secondary">Weight: {pm.weight}</span>
                                <PeriodMetricForm
                                    metrics={metrics}
                                    periodId={periodId}
                                    allianceId={allianceId}
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
            {availableMetrics.length > 0 ? (
                <PeriodMetricForm
                    metrics={availableMetrics}
                    periodId={periodId}
                    allianceId={allianceId}
                    mode="create"
                    onClose={() => {}}
                />
            ) : (
                <p className="text-text-muted text-sm">
                    All metrics have been assigned to this period.{' '}
                    <Link
                        href={`/alliances/${allianceId}/metrics`}
                        className="text-primary-light hover:text-primary underline"
                    >
                        Create more metrics
                    </Link>{' '}
                    in the Metrics Library to add them here.
                </p>
            )}
        </div>
    );
}
