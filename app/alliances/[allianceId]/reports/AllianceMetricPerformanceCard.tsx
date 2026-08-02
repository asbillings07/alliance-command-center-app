import { Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import type { AllianceMetricPerformance } from "@/app/src/lib/reports/getAlliancePerformanceReport";
import {
  attachmentStatusBadge,
  buildMetricCardBody,
  formatCardComparisonSummary,
  formatCardCoverageSummary,
  SUMMARY_KIND_BADGE_LABEL,
} from "./allianceReportDisplay";

type Props = {
  allianceId: string;
  periodId: string;
  performance: AllianceMetricPerformance;
};

/**
 * One metric's honest performance card on the alliance overview (#264).
 * Every summary kind and attachment/data state renders something truthful
 * here — there is no "hide the card if it looks empty" branch, because the
 * absence itself (not attached, inactive, no results yet) is exactly what
 * the report exists to reveal. Actions are read-only: recovery CTAs
 * (Record Now, Attach, Reactivate) already live on the per-metric drill-down
 * page this card links to, so they aren't duplicated here.
 */
export function AllianceMetricPerformanceCard({ allianceId, periodId, performance }: Props) {
  const { metric, attachmentStatus, dataStatus, rollup, coverage, comparison } = performance;

  const attachmentBadge = attachmentStatusBadge(attachmentStatus);
  const summaryKindLabel = SUMMARY_KIND_BADGE_LABEL[metric.summaryKind];
  const body = buildMetricCardBody({ dataStatus, attachmentStatus, rollup, unitLabel: metric.unitLabel });
  const coverageSummary = formatCardCoverageSummary(attachmentStatus, coverage);
  const comparisonSummary = formatCardComparisonSummary(comparison, metric.summaryKind, metric.unitLabel);

  return (
    <div data-testid={`alliance-metric-card-${metric.id}`}>
      <Card className={!metric.active ? "opacity-60" : ""}>
        <Card.Body>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h3 className="text-base font-semibold text-text-primary">{metric.name}</h3>
                {summaryKindLabel && (
                  <Badge variant="neutral" size="sm">
                    {summaryKindLabel}
                    {metric.unitLabel ? ` (${metric.unitLabel})` : ""}
                  </Badge>
                )}
                {!metric.active && (
                  <Badge variant="neutral" size="sm">
                    Archived
                  </Badge>
                )}
                {attachmentBadge && (
                  <Badge variant={attachmentBadge.variant} size="sm">
                    {attachmentBadge.label}
                  </Badge>
                )}
              </div>

              {body.kind === "HEADLINE" ? (
                <p className="text-2xl font-bold text-text-primary" data-testid="alliance-card-headline">
                  {body.text}
                </p>
              ) : (
                <p
                  className="text-sm text-text-muted"
                  data-testid={body.kind === "NO_VALUES" ? "alliance-card-no-values" : "alliance-card-no-rollup"}
                >
                  {body.text}
                </p>
              )}

              {comparisonSummary && (
                <p className="text-sm text-text-secondary mt-1" data-testid="alliance-card-comparison">
                  {comparisonSummary}
                </p>
              )}
              {coverageSummary && (
                <p className="text-xs text-text-muted mt-1" data-testid="alliance-card-coverage">
                  {coverageSummary}
                </p>
              )}
            </div>

            <Button
              href={`/alliances/${allianceId}/reports/metrics/${metric.id}?periodId=${periodId}`}
              variant="secondary"
              size="sm"
            >
              View Report
            </Button>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
