import { formatPower } from "@/app/src/lib/formatPower";
import { Card, EmptyState, Badge, type BadgeVariant } from "@/app/src/components";

export type MetricEntryViewModel = {
    value: number;
    recordedAt: Date;
};

/**
 * Whether a `comparable` trend's `direction` is good or bad news, per the
 * metric's own `trendDirection` config (`metricTrendDirection.ts`) - see
 * `classifyTrendFavorability`'s doc comment in `memberPerformanceViewModel.ts`
 * for why this must not be inferred from `direction` alone.
 */
export type TrendFavorability = "favorable" | "adverse" | "neutral";

/**
 * #321's period-over-period trend - visually and semantically distinct from
 * `delta` above (a same-period correction). `new`/`no-baseline` are the two
 * "nothing to compare" states locked in #321's scope comment: `new` means
 * the alliance has no period before this one at all; `no-baseline`
 * collapses every other missing-comparison case (metric not attached to
 * the prior period, member wasn't active yet, prior value voided/absent)
 * into one leader-facing state, deliberately not distinguishing why.
 */
export type PeriodTrendViewModel =
    | { status: "new" }
    | { status: "no-baseline" }
    | {
          status: "comparable";
          currentValue: number;
          previousValue: number;
          delta: number;
          direction: "up" | "down" | "flat";
          favorability: TrendFavorability;
      };

export type CurrentMetricViewModel = {
    metricId: string;
    metricName: string;
    current?: MetricEntryViewModel;
    previous?: MetricEntryViewModel;
    delta?: number;
    /**
     * Absent (not just an "n/a" status) whenever `current` above is itself
     * undefined - see `buildPeriodTrendViewModels`'s doc comment for why a
     * void/never-recorded current period has no trend to show at all.
     */
    periodTrend?: PeriodTrendViewModel;
};

export type MemberPerformanceProps = {
    periodSelector?: React.ReactNode;
    periodStatusLabel?: string;
    action?: React.ReactNode;
    unrecordedNotice?: React.ReactNode;
} & (
    | { emptyState: "no-period" }
    | { emptyState: "no-metrics"; periodName: string }
    | {
          emptyState: "has-metrics";
          periodName: string;
          metrics: CurrentMetricViewModel[];
          /**
           * Name of the period `periodTrend`'s badges compare against -
           * rendered as visible muted text next to each badge
           * ("[+50] vs. Week 18"), not just its tooltip, so the baseline is
           * readable without hovering. Absent for "New" (no prior period
           * exists at all, so there is nothing to name).
           */
          previousPeriodName?: string;
      }
);

function formatSignedPower(value: number): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatPower(value)}`;
}

const TREND_ARROW: Record<"up" | "down" | "flat", string> = {
    up: "▲",
    down: "▼",
    flat: "–",
};

const FAVORABILITY_BADGE_VARIANT: Record<TrendFavorability, BadgeVariant> = {
    favorable: "success",
    adverse: "danger",
    neutral: "neutral",
};

/**
 * Deliberately a `Badge`, not the plain muted text `delta` above renders as
 * - the whole point of #323 is that a leader can tell "this changed because
 * of a correction" (`delta`, same-period, always neutral gray text) apart
 * from "this changed period over period" (this badge, color-coded by
 * whether the change is good or bad news for *this* metric) at a glance,
 * not just by reading the copy closely.
 *
 * The pill itself carries only the status (arrow + delta, or "N/A") - the
 * comparison period's name renders as adjacent muted text, not crammed
 * inside the pill. An earlier version put the whole sentence ("+50 vs. Week
 * 18 (4/6/2026 – 4/13/2026)") inside the badge itself; once #349 started
 * passing the full collision-safe label (which can include a date range or
 * an id suffix, not just a short name) as that comparison text, the pill
 * stopped reading as a pill at all and started reading as a run-on
 * sentence. Splitting them lets the pill stay a fixed-size status chip
 * while the comparison text wraps freely beside it. `min-w-0` on the outer
 * wrapper is required, not decorative: without it, a flex item won't
 * shrink below its content's intrinsic width, so long comparison text would
 * push the metric name out of the card instead of wrapping.
 *
 * The `title` attribute is this project's existing lightweight tooltip
 * convention (see `ImportForm.tsx`'s truncated-column-name tooltip) - kept
 * as reinforcement for mouse users, but never the *only* place the full
 * baseline is named: an owner found (production, #332 internal-
 * stabilization pass) that a hover-only tooltip is inaccessible on touch
 * devices, so the comparison text below is always visible on its own,
 * never tooltip-only.
 *
 * #325 documented this exact copy (both this badge's and the correction
 * `delta` line's) in `docs/changelog.md` for a leader-facing audience -
 * if either changes materially, add a **new** changelog entry describing
 * the change (that file is append-only release history, never edited to
 * match current behavior after the fact).
 */
function PeriodTrendBadge({ trend, periodName }: { trend: PeriodTrendViewModel; periodName?: string }) {
    if (trend.status === "new") {
        return (
            <span title="No earlier evaluation period exists yet to compare against.">
                <Badge variant="info" size="sm">
                    New
                </Badge>
            </span>
        );
    }

    // `periodName` is expected whenever a "no-baseline" or "comparable"
    // trend exists (the page only builds either when a prior period was
    // actually found - see `buildPeriodTrendViewModels`'s doc comment) - the
    // generic fallback below exists only for defensive completeness, e.g. a
    // caller passing this component a hand-built view model without it.
    const comparisonLabel = periodName ?? "last period";
    const isNoBaseline = trend.status === "no-baseline";

    const tooltip = isNoBaseline
        ? `No comparable value was recorded for this metric in the previous evaluation period (${comparisonLabel}).`
        : `Trend vs. the previous evaluation period (${comparisonLabel}) - not a same-period correction.`;

    return (
        <span
            className="inline-flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 gap-y-0.5 text-right"
            title={tooltip}
        >
            <Badge variant={isNoBaseline ? "neutral" : FAVORABILITY_BADGE_VARIANT[trend.favorability]} size="sm">
                {isNoBaseline ? "N/A" : `${TREND_ARROW[trend.direction]} ${formatSignedPower(trend.delta)}`}
            </Badge>
            <span className="text-xs text-text-muted">vs. {comparisonLabel}</span>
        </span>
    );
}

function MetricCard({ metric, previousPeriodName }: { metric: CurrentMetricViewModel; previousPeriodName?: string }) {
    const hasCurrent = metric.current !== undefined;
    const hasDelta = metric.delta !== undefined && metric.delta !== 0;

    return (
        <Card>
            <Card.Body className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm font-medium text-text-secondary">
                        {metric.metricName}
                    </div>
                    {metric.periodTrend && (
                        <PeriodTrendBadge trend={metric.periodTrend} periodName={previousPeriodName} />
                    )}
                </div>
                {hasCurrent ? (
                    <>
                        <div className="text-2xl font-bold text-primary">
                            {formatPower(metric.current!.value)}
                        </div>
                        {hasDelta && (
                            <div
                                className="text-sm text-text-muted mt-1"
                                title="Change from the previous entry recorded in this same evaluation period (e.g. a correction) - not a period-over-period trend."
                            >
                                {formatSignedPower(metric.delta!)} since last entry
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
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-primary">Performance</h2>
                    {props.periodSelector}
                </div>
                <EmptyState
                    title="No evaluation period found"
                    description="Create a period to begin tracking member performance."
                    action={props.action}
                />
            </section>
        );
    }

    if (props.emptyState === "no-metrics") {
        return (
            <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-primary">{props.periodName}</h2>
                        {props.periodStatusLabel && (
                            <span className="text-xs text-text-muted">{props.periodStatusLabel}</span>
                        )}
                    </div>
                    {props.periodSelector}
                </div>
                <EmptyState
                    title="No metrics configured"
                    description="No metrics have been configured for this evaluation period."
                    action={props.action}
                />
            </section>
        );
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-primary">{props.periodName}</h2>
                    {props.periodStatusLabel && (
                        <span className="text-xs text-text-muted">{props.periodStatusLabel}</span>
                    )}
                </div>
                {props.periodSelector}
            </div>
            {props.unrecordedNotice && (
                <div className="rounded-lg border border-border bg-surface-secondary p-4 text-sm text-text-primary">
                    {props.unrecordedNotice}
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {props.metrics.map((metric) => (
                    <MetricCard key={metric.metricId} metric={metric} previousPeriodName={props.previousPeriodName} />
                ))}
            </div>
        </section>
    );
}
