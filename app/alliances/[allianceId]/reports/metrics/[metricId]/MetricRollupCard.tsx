import { Card, Badge } from "@/app/src/components";
import type { MetricInfo, MetricRollup, MetricSummaryComparison } from "@/app/src/lib/reports/getMetricSummaryReport";
import { formatRollupHeadline, formatRollupChange } from "../../reportRollupDisplay";
import { MetricComparisonControl } from "./MetricComparisonControl";

type Props = {
  allianceId: string;
  metricId: string;
  metric: MetricInfo;
  rollup: MetricRollup;
  comparison: MetricSummaryComparison | null;
};

function RollupBody({ metric, rollup }: { metric: MetricInfo; rollup: MetricRollup }) {
  if (rollup.kind === "SUM") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-3xl font-bold text-text-primary" data-testid="rollup-headline">
          {formatRollupHeadline(rollup, metric.unitLabel)}
        </p>
        <p className="text-sm text-text-muted">Alliance total</p>
        {rollup.hasNegativeValues && (
          <p className="text-sm text-warning-light mt-1" data-testid="rollup-negative-values-note">
            This total includes negative values, so each member&apos;s share of total is unavailable.
          </p>
        )}
      </div>
    );
  }

  if (rollup.kind === "AVERAGE") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-3xl font-bold text-text-primary" data-testid="rollup-headline">
          {formatRollupHeadline(rollup, metric.unitLabel) ?? "—"}
        </p>
        <p className="text-sm text-text-muted">Alliance average</p>
      </div>
    );
  }

  if (rollup.kind === "TRUE_RATE") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-3xl font-bold text-text-primary" data-testid="rollup-headline">
          {formatRollupHeadline(rollup, null) ?? "—"}
        </p>
        <p className="text-sm text-text-muted">
          {rollup.trueCount} yes / {rollup.falseCount} no
        </p>
        {rollup.invalidCount > 0 && (
          <p className="text-sm text-warning-light" data-testid="rollup-invalid-note">
            {rollup.invalidCount} legacy invalid {rollup.invalidCount === 1 ? "value" : "values"} excluded from the
            rate.
          </p>
        )}
      </div>
    );
  }

  return null;
}

/**
 * The report's rollup summary card (#190) — its shape is driven entirely by
 * `Metric.summaryKind`. Renders nothing for `NONE`: a metric with no
 * configured rollup has no alliance-wide number to headline, only the
 * member roster below.
 */
export function MetricRollupCard({ allianceId, metricId, metric, rollup, comparison }: Props) {
  if (rollup.kind === "NONE") {
    return null;
  }

  const changeText =
    comparison?.status === "COMPARED"
      ? formatRollupChange(metric.summaryKind, comparison.absoluteChange, comparison.percentageChange, metric.unitLabel)
      : null;
  const comparisonPeriodName = comparison?.status === "COMPARED" ? comparison.period.name : null;

  return (
    <Card>
      <Card.Header>Summary</Card.Header>
      <Card.Body>
        <div className="flex flex-col gap-4">
          <RollupBody metric={metric} rollup={rollup} />

          {changeText && (
            <p className="text-sm text-text-secondary" data-testid="rollup-change">
              <Badge variant="info" size="sm">
                {changeText}
              </Badge>{" "}
              vs {comparisonPeriodName}
            </p>
          )}

          {comparison && <MetricComparisonControl allianceId={allianceId} metricId={metricId} comparison={comparison} />}
        </div>
      </Card.Body>
    </Card>
  );
}
