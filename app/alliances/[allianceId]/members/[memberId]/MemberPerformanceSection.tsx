import { formatPower } from "@/app/src/lib/formatPower";
import { Card, EmptyState } from "@/app/src/components";

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

export type MemberPerformanceProps =
    | { emptyState: "no-period" }
    | { emptyState: "no-metrics"; periodName: string }
    | { emptyState: "has-metrics"; periodName: string; metrics: CurrentMetricViewModel[] };

function MetricCard({ metric }: { metric: CurrentMetricViewModel }) {
    const hasCurrent = metric.current !== undefined;
    const hasDelta = metric.delta !== undefined && metric.delta !== 0;

    const formatDelta = (delta: number) => {
        const sign = delta > 0 ? "+" : "";
        return `${sign}${formatPower(delta)}`;
    };

    return (
        <Card>
            <Card.Body className="p-4">
                <div className="text-sm font-medium text-text-secondary mb-1">
                    {metric.metricName}
                </div>
                {hasCurrent ? (
                    <>
                        <div className="text-2xl font-bold text-primary">
                            {formatPower(metric.current!.value)}
                        </div>
                        {hasDelta && (
                            <div className="text-sm text-text-muted mt-1">
                                {formatDelta(metric.delta!)} since last entry
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-lg text-text-muted">
                        Not recorded
                    </div>
                )}
            </Card.Body>
        </Card>
    );
}

export function MemberPerformanceSection(props: MemberPerformanceProps) {
    if (props.emptyState === "no-period") {
        return (
            <section className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-center text-primary">
                    Performance
                </h2>
                <EmptyState
                    title="No active evaluation period"
                    description="Create or activate a period to begin tracking member performance."
                />
            </section>
        );
    }

    if (props.emptyState === "no-metrics") {
        return (
            <section className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-center text-primary">
                    {props.periodName}
                </h2>
                <EmptyState
                    title="No metrics configured"
                    description="No metrics have been configured for this evaluation period."
                />
            </section>
        );
    }

    return (
        <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold text-center text-primary">
                {props.periodName}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {props.metrics.map((metric) => (
                    <MetricCard key={metric.metricId} metric={metric} />
                ))}
            </div>
        </section>
    );
}
