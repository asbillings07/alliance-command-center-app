import { Card, Badge } from "@/app/src/components";
import type { AllianceOverallCoverage } from "@/app/src/lib/reports/getAlliancePerformanceReport";
import { formatOverallCoveragePercent } from "./allianceReportDisplay";

type Props = {
  totalMetricCount: number;
  overallCoverage: AllianceOverallCoverage;
};

/**
 * Alliance-wide facts (#264) — deliberately raw counts, not judgments.
 * Ranking/severity/recovery guidance belongs to the "needs attention"
 * findings engine (a later PR in #264), not here.
 */
export function AllianceAtAGlanceCards({ totalMetricCount, overallCoverage }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="alliance-at-a-glance-cards">
      <Card>
        <Card.Body>
          <p className="text-sm text-text-muted">Metrics this period</p>
          <p className="text-3xl font-bold text-text-primary" data-testid="at-a-glance-metric-count">
            {totalMetricCount}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="success" size="sm">
              {overallCoverage.activeAttachmentCount} attached
            </Badge>
            {overallCoverage.notAttachedCount > 0 && (
              <Badge variant="warning" size="sm">
                {overallCoverage.notAttachedCount} not attached
              </Badge>
            )}
            {overallCoverage.inactiveAttachmentCount > 0 && (
              <Badge variant="neutral" size="sm">
                {overallCoverage.inactiveAttachmentCount} inactive
              </Badge>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <p className="text-sm text-text-muted">Coverage across active attachments</p>
          <p className="text-3xl font-bold text-text-primary" data-testid="at-a-glance-coverage">
            {formatOverallCoveragePercent(overallCoverage)}
          </p>
          {overallCoverage.expectedCells > 0 && (
            <p className="text-sm text-text-secondary mt-2">
              {overallCoverage.validCells} of {overallCoverage.expectedCells} active-member/metric cells have a valid
              result
            </p>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
