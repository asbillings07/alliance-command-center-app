import { Card, Badge } from "@/app/src/components";
import type { MemberRosterFilter, MetricCoverage } from "@/app/src/lib/reports/getMetricSummaryReport";

type Props = {
  coverage: MetricCoverage;
  filter: MemberRosterFilter;
};

/**
 * Coverage is always reported over the *current active roster*, not a
 * historical membership snapshot (#190) — ACC doesn't retain who was active
 * at the time a period ran, only who is active now. The archived-contributor
 * reconciliation note keeps the visible "active" filter honest about
 * contributors the alliance total includes but the roster view is currently
 * hiding.
 */
export function MetricCoverageCard({ coverage, filter }: Props) {
  return (
    <div data-testid="metric-coverage-card">
    <Card>
      <Card.Header
        action={
          <Badge variant={coverage.complete ? "success" : "warning"} size="sm">
            {coverage.complete ? "Complete" : "Incomplete"}
          </Badge>
        }
      >
        Coverage
      </Card.Header>
      <Card.Body>
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-text-primary">
            <strong>{coverage.recordedActiveMemberCount}</strong> of{" "}
            <strong>{coverage.currentActiveMemberCount}</strong> current active members have a recorded value
          </p>
          {coverage.missingActiveMemberCount > 0 && (
            <p className="text-text-secondary">
              {coverage.missingActiveMemberCount} active member{coverage.missingActiveMemberCount === 1 ? "" : "s"}{" "}
              missing a value
            </p>
          )}
          {coverage.invalidActiveMemberCount > 0 && (
            <p className="text-warning-light" data-testid="coverage-invalid-note">
              {coverage.invalidActiveMemberCount} active member{coverage.invalidActiveMemberCount === 1 ? "" : "s"}{" "}
              recorded an invalid legacy value, excluded from the rate
            </p>
          )}
          {coverage.archivedContributingMemberCount > 0 && filter === "active" && (
            <p className="text-xs text-text-muted" data-testid="archived-contributors-note">
              Total also includes {coverage.archivedContributingMemberCount} archived contributor
              {coverage.archivedContributingMemberCount === 1 ? "" : "s"} currently hidden by this filter.
            </p>
          )}
        </div>
      </Card.Body>
    </Card>
    </div>
  );
}
