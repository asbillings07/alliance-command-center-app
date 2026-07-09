import { formatPower } from "@/app/src/lib/formatPower";

export type MetricEntryViewModel = {
    value: number;
    recordedAt: Date;
};

export type CurrentMetricViewModel = {
    metricId: string;
    metricName: string;
    current?: MetricEntryViewModel;
    previous?: MetricEntryViewModel;
    delta?: number;
};

export type MemberPerformanceProps = {
    periodName: string | null;
    metrics: CurrentMetricViewModel[];
    emptyState: "no-period" | "no-metrics" | "has-metrics";
};

function MetricCard({ metric }: { metric: CurrentMetricViewModel }) {
    const hasCurrent = metric.current !== undefined;
    const hasDelta = metric.delta !== undefined && metric.delta !== 0;

    const formatDelta = (delta: number) => {
        const sign = delta > 0 ? "+" : "";
        return `${sign}${formatPower(delta)}`;
    };

    return (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-sm font-medium text-gray-600 mb-1">
                {metric.metricName}
            </div>
            {hasCurrent ? (
                <>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatPower(metric.current!.value)}
                    </div>
                    {hasDelta && (
                        <div className="text-sm text-gray-500 mt-1">
                            {formatDelta(metric.delta!)} since last entry
                        </div>
                    )}
                </>
            ) : (
                <div className="text-lg text-gray-400">
                    Not recorded
                </div>
            )}
        </div>
    );
}

export function MemberPerformanceSection({ periodName, metrics, emptyState }: MemberPerformanceProps) {
    if (emptyState === "no-period") {
        return (
            <section className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-center text-gray-900">
                    Performance
                </h2>
                <div className="text-center py-8 px-4 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-gray-600">No active evaluation period.</p>
                    <p className="text-sm text-gray-500 mt-1">
                        Create or activate a period to begin tracking member performance.
                    </p>
                </div>
            </section>
        );
    }

    if (emptyState === "no-metrics") {
        return (
            <section className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-center text-gray-900">
                    {periodName}
                </h2>
                <div className="text-center py-8 px-4 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-gray-600">No metrics have been configured for this evaluation period.</p>
                </div>
            </section>
        );
    }

    return (
        <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold text-center text-gray-900">
                {periodName}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {metrics.map((metric) => (
                    <MetricCard key={metric.metricId} metric={metric} />
                ))}
            </div>
        </section>
    );
}
