import type { ReactNode } from "react";
import { Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import type { DashboardWorkflowViewModel } from "./dashboardWorkflowViewModel";

export type WorkflowDashboardProps = {
  allianceId: string;
  viewModel: DashboardWorkflowViewModel;
  setupProgressCard: ReactNode;
};

function RosterHealthGroup({ allianceId, viewModel }: { allianceId: string; viewModel: DashboardWorkflowViewModel }) {
  const { health, degraded } = viewModel.roster;

  return (
    <section>
      <h2 className="text-lg font-semibold text-primary mb-1">Roster health</h2>
      <p className="text-sm text-text-secondary mb-4">Who is in your alliance, and what changed recently.</p>
      <Card>
        <Card.Body>
          <div className="flex items-start justify-between gap-4">
            <div>
              {degraded ? (
                <p className="text-sm text-text-secondary">
                  Roster stats are temporarily unavailable. Your roster itself is unaffected.
                </p>
              ) : health ? (
                <>
                  <p className="text-sm text-text-secondary">
                    <strong className="text-text-primary">{health.activeCount}</strong> active member
                    {health.activeCount === 1 ? "" : "s"}
                    {health.archivedCount > 0 && (
                      <>
                        {" "}
                        · <strong className="text-text-primary">{health.archivedCount}</strong> archived
                      </>
                    )}
                  </p>
                  {health.latestImport && (
                    <p className="text-sm text-text-secondary mt-2">
                      Last import: {health.latestImport.createdCount} added
                      {health.latestImport.restoredCount > 0 && `, ${health.latestImport.restoredCount} restored`}
                      {health.latestImport.rolledBack && " (rolled back)"}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </div>
          <div className="mt-4">
            <Button href={`/alliances/${allianceId}/members`} variant="primary" size="sm">
              View Members
            </Button>
          </div>
        </Card.Body>
      </Card>
    </section>
  );
}

function ParticipationEvaluationGroup({
  allianceId,
  viewModel,
}: {
  allianceId: string;
  viewModel: DashboardWorkflowViewModel;
}) {
  const { cardState, showMetricsLibraryCard, showPeriodsCard, showReportsCard, actionableFindingCount, degraded } =
    viewModel.participation;

  return (
    <section>
      <h2 className="text-lg font-semibold text-primary mb-1">Participation and evaluation</h2>
      <p className="text-sm text-text-secondary mb-4">
        Configure what you track, record results, and review coverage.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {cardState && (
          <Card>
            <Card.Body>
              <h3 className="font-medium text-primary mb-2">Evaluation Results</h3>

              {cardState.kind === "no-period" && (
                <>
                  <p className="text-sm text-text-secondary mb-4">
                    {cardState.hasArchivedPeriodsOnly
                      ? "Only inactive evaluation periods exist. Restore one or create a new period before recording or importing results."
                      : "No evaluation periods yet. Create one before recording or importing member results."}
                  </p>
                  {cardState.canConfigurePeriods ? (
                    <Button href={`/alliances/${allianceId}/periods`} variant="primary" size="sm">
                      Go to Evaluation Periods
                    </Button>
                  ) : (
                    <p className="text-sm text-text-secondary">
                      Ask an Admin or Owner to create or restore an evaluation period.
                    </p>
                  )}
                </>
              )}

              {cardState.kind === "no-active-members" && (
                <>
                  <p className="text-sm text-text-secondary mb-4">
                    Import members before recording or importing evaluation results for{" "}
                    <strong>{cardState.periodName}</strong>.
                  </p>
                  {cardState.canImportMembers ? (
                    <Button href={`/alliances/${allianceId}/members/import`} variant="primary" size="sm">
                      Import Members
                    </Button>
                  ) : (
                    <p className="text-sm text-text-secondary">Ask an Admin or Owner to import members.</p>
                  )}
                </>
              )}

              {cardState.kind === "no-metrics-blocked" && (
                <>
                  <p className="text-sm text-text-secondary mb-4">
                    Active period <strong>{cardState.periodName}</strong> has no assigned metrics yet. Configure
                    period metrics before recording results.
                  </p>
                  <Button
                    href={`/alliances/${allianceId}/periods/${cardState.periodId}`}
                    variant={cardState.canConfigurePeriods ? "primary" : "secondary"}
                    size="sm"
                  >
                    {cardState.canConfigurePeriods ? "Manage Period Metrics" : "View Period"}
                  </Button>
                </>
              )}

              {cardState.kind === "no-metrics-can-import" && (
                <>
                  <p className="text-sm text-text-secondary mb-4">
                    Active period <strong>{cardState.periodName}</strong> has no assigned metrics yet. Import a
                    spreadsheet to attach metrics and add results.
                  </p>
                  <Button
                    href={`/alliances/${allianceId}/periods/${cardState.periodId}/import`}
                    variant="primary"
                    size="sm"
                  >
                    Import Evaluation Results
                  </Button>
                </>
              )}

              {cardState.kind === "ready" && (
                <>
                  <p className="text-sm text-text-secondary mb-4">
                    Record or import performance data for <strong>{cardState.periodName}</strong>.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      href={`/alliances/${allianceId}/periods/${cardState.periodId}/record`}
                      variant="primary"
                      size="sm"
                    >
                      Record Now
                    </Button>
                    <Button
                      href={`/alliances/${allianceId}/periods/${cardState.periodId}/import`}
                      variant="secondary"
                      size="sm"
                    >
                      Import Evaluation Results
                    </Button>
                  </div>

                  {/*
                    Both `actionableFindingCount` and `degraded` are already
                    null/false-forced by the view model whenever
                    `showReportsCard` is false (#332 Preview feedback: a
                    leader must never see "N items need attention" with
                    nothing to click - Reports is this signal's only
                    destination today). No `showReportsCard` check needed
                    here - see dashboardWorkflowViewModel.ts.
                  */}
                  {degraded ? (
                    <p className="text-sm text-text-secondary mt-4">
                      Coverage status is temporarily unavailable.
                    </p>
                  ) : actionableFindingCount !== null && actionableFindingCount > 0 ? (
                    <p className="text-sm text-warning mt-4">
                      {actionableFindingCount} item{actionableFindingCount === 1 ? "" : "s"} need
                      {actionableFindingCount === 1 ? "s" : ""} attention{" — "}
                      <Button href={`/alliances/${allianceId}/reports`} variant="link" size="sm">
                        view in Reports
                      </Button>
                    </p>
                  ) : null}
                </>
              )}
            </Card.Body>
          </Card>
        )}

        {showMetricsLibraryCard && (
          <Card>
            <Card.Body>
              <h3 className="font-medium text-primary mb-2">Metrics Library</h3>
              <p className="text-sm text-text-secondary mb-4">Define the metrics you track for your alliance.</p>
              <Button href={`/alliances/${allianceId}/metrics`} variant="primary" size="sm">
                Manage Metrics
              </Button>
            </Card.Body>
          </Card>
        )}

        {showPeriodsCard && (
          <Card>
            <Card.Body>
              <h3 className="font-medium text-primary mb-2">Evaluation Periods</h3>
              <p className="text-sm text-text-secondary mb-4">Create and manage evaluation periods for tracking.</p>
              <Button href={`/alliances/${allianceId}/periods`} variant="primary" size="sm">
                Manage Periods
              </Button>
            </Card.Body>
          </Card>
        )}

        {showReportsCard && (
          <Card>
            <Card.Body>
              <h3 className="font-medium text-primary mb-2">Reports</h3>
              <p className="text-sm text-text-secondary mb-4">
                Metric summaries, rankings, and period-over-period change.
              </p>
              <Button href={`/alliances/${allianceId}/reports`} variant="primary" size="sm">
                View Reports
              </Button>
            </Card.Body>
          </Card>
        )}
      </div>
    </section>
  );
}

function SetupGroup({
  allianceId,
  viewModel,
  setupProgressCard,
}: {
  allianceId: string;
  viewModel: DashboardWorkflowViewModel;
  setupProgressCard: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-primary mb-1">Setup and data freshness</h2>
      <p className="text-sm text-text-secondary mb-4">What&apos;s left to configure, and who can help.</p>
      <div className="flex flex-col gap-4">
        {setupProgressCard}
        {viewModel.setup.showLeadershipTeamCard && (
          <Card>
            <Card.Body>
              <h3 className="font-medium text-primary mb-2">Leadership Team</h3>
              <p className="text-sm text-text-secondary mb-4">Invite collaborators to help manage your alliance.</p>
              <Button href={`/alliances/${allianceId}/settings/invitations`} variant="primary" size="sm">
                Manage Team
              </Button>
            </Card.Body>
          </Card>
        )}
      </div>
    </section>
  );
}

/**
 * The #192 grouped dashboard - organizes cards into leader-workflow groups
 * (Setup and data freshness, Roster health, Participation and evaluation)
 * instead of a flat module grid. Phase 1 of 3 planned groups; "Leadership
 * work" and "Recent activity" are intentionally deferred follow-ups (see
 * #192's phase-1 scope comment), not omissions.
 *
 * Renders purely from `viewModel` (see `dashboardWorkflowViewModel.ts`) plus
 * the already-composed `SetupProgressCard` element - no data loading here.
 */
export function WorkflowDashboard({ allianceId, viewModel, setupProgressCard }: WorkflowDashboardProps) {
  return (
    <div className="flex flex-col gap-8">
      <SetupGroup allianceId={allianceId} viewModel={viewModel} setupProgressCard={setupProgressCard} />
      <RosterHealthGroup allianceId={allianceId} viewModel={viewModel} />
      <ParticipationEvaluationGroup allianceId={allianceId} viewModel={viewModel} />
    </div>
  );
}
