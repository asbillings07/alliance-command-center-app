import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { resolveTargetPeriod } from "@/app/src/lib/periods/resolveTargetPeriod";
import { canProvisionMetricsForPeriod } from "@/app/src/lib/periods/canProvisionMetricsForPeriod";
import { PageLayout, Card, Badge, SetupProgressCard } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

async function getAttachableLibraryMetricCount(
  allianceId: string,
  assignedMetricIds: string[],
): Promise<number> {
  return prisma.metric.count({
    where: {
      allianceId,
      active: true,
      ...(assignedMetricIds.length > 0
        ? { id: { notIn: assignedMetricIds } }
        : {}),
    },
  });
}

export default async function AlliancePage({ params }: Params) {
  const { allianceId } = await params;
  if (!allianceId) {
    redirect("/app");
  }

  const auth = await requireAllianceAccess({ allianceId });
  const { permissions } = auth;

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
  });

  if (!alliance) {
    redirect("/app");
  }

  const setupStatus = await getAllianceSetupStatus(allianceId, permissions);

  const activePeriod = permissions.canImportMetrics
    ? await resolveTargetPeriod(allianceId)
    : null;

  const assignedMetricIds =
    activePeriod?.periodMetrics.map((pm) => pm.metricId) ?? [];
  const attachableLibraryMetricCount = activePeriod
    ? await getAttachableLibraryMetricCount(allianceId, assignedMetricIds)
    : 0;
  const hasPeriodMetrics = assignedMetricIds.length > 0;
  const hasActiveMembers = setupStatus.activeMemberCount > 0;
  const canProvision = canProvisionMetricsForPeriod({
    canConfigureMetrics: permissions.canConfigureMetrics,
    canConfigurePeriods: permissions.canConfigurePeriods,
    attachableLibraryMetricCount,
  });

  return (
    <PageLayout
      title={alliance.name}
      description={`Server: ${alliance.server}`}
    >
      <div className="flex flex-col gap-6">
        <SetupProgressCard
          allianceId={allianceId}
          completedCount={setupStatus.completedCount}
          totalCount={setupStatus.totalCount}
          recommendedTask={setupStatus.recommendedTask}
        />

        <Card>
          <Card.Body>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary">Your Role</h2>
                <p className="text-text-secondary mt-1">Access level for this alliance</p>
              </div>
              <Badge variant="info">{auth.membership.role}</Badge>
            </div>
          </Card.Body>
        </Card>

        <div>
          <h2 className="text-lg font-semibold text-primary mb-4">Modules</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <Card.Body>
                <h3 className="font-medium text-primary mb-2">Members</h3>
                <p className="text-sm text-text-secondary mb-4">
                  Manage your alliance members and player data.
                </p>
                <Button href={`/alliances/${allianceId}/members`} variant="primary" size="sm">
                  View Members
                </Button>
              </Card.Body>
            </Card>

            {permissions.canViewMembers && (
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

            {permissions.canImportMetrics && !activePeriod && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Evaluation Results</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    {setupStatus.hasArchivedPeriodsOnly
                      ? "Only inactive evaluation periods exist. Restore one or create a new period before recording or importing results."
                      : "No evaluation periods yet. Create one before recording or importing member results."}
                  </p>
                  {permissions.canConfigurePeriods ? (
                    <Button href={`/alliances/${allianceId}/periods`} variant="primary" size="sm">
                      Go to Evaluation Periods
                    </Button>
                  ) : (
                    <p className="text-sm text-text-secondary">
                      Ask an Admin or Owner to create or restore an evaluation period.
                    </p>
                  )}
                </Card.Body>
              </Card>
            )}

            {permissions.canImportMetrics && activePeriod && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Evaluation Results</h3>
                  {!hasActiveMembers ? (
                    <>
                      <p className="text-sm text-text-secondary mb-4">
                        Import members before recording or importing evaluation results for{" "}
                        <strong>{activePeriod.name}</strong>.
                      </p>
                      {permissions.canImportMembers ? (
                        <Button
                          href={`/alliances/${allianceId}/members/import`}
                          variant="primary"
                          size="sm"
                        >
                          Import Members
                        </Button>
                      ) : (
                        <p className="text-sm text-text-secondary">
                          Ask an Admin or Owner to import members.
                        </p>
                      )}
                    </>
                  ) : !hasPeriodMetrics && !canProvision ? (
                    <>
                      <p className="text-sm text-text-secondary mb-4">
                        Active period <strong>{activePeriod.name}</strong> has no assigned metrics yet.
                        Configure period metrics before recording results.
                      </p>
                      {permissions.canConfigurePeriods ? (
                        <Button
                          href={`/alliances/${allianceId}/periods/${activePeriod.id}`}
                          variant="primary"
                          size="sm"
                        >
                          Manage Period Metrics
                        </Button>
                      ) : (
                        <Button
                          href={`/alliances/${allianceId}/periods/${activePeriod.id}`}
                          variant="secondary"
                          size="sm"
                        >
                          View Period
                        </Button>
                      )}
                    </>
                  ) : !hasPeriodMetrics && canProvision ? (
                    <>
                      <p className="text-sm text-text-secondary mb-4">
                        Active period <strong>{activePeriod.name}</strong> has no assigned metrics yet.
                        Import a spreadsheet to attach metrics and add results.
                      </p>
                      <Button
                        href={`/alliances/${allianceId}/periods/${activePeriod.id}/import`}
                        variant="primary"
                        size="sm"
                      >
                        Import Evaluation Results
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-text-secondary mb-4">
                        Record or import performance data for <strong>{activePeriod.name}</strong>.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          href={`/alliances/${allianceId}/periods/${activePeriod.id}/record`}
                          variant="primary"
                          size="sm"
                        >
                          Record Now
                        </Button>
                        <Button
                          href={`/alliances/${allianceId}/periods/${activePeriod.id}/import`}
                          variant="secondary"
                          size="sm"
                        >
                          Import Evaluation Results
                        </Button>
                      </div>
                    </>
                  )}
                </Card.Body>
              </Card>
            )}

            {permissions.canConfigureMetrics && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Metrics Library</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Define the metrics you track for your alliance.
                  </p>
                  <Button href={`/alliances/${allianceId}/metrics`} variant="primary" size="sm">
                    Manage Metrics
                  </Button>
                </Card.Body>
              </Card>
            )}

            {permissions.canConfigurePeriods && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Evaluation Periods</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Create and manage evaluation periods for tracking.
                  </p>
                  <Button href={`/alliances/${allianceId}/periods`} variant="primary" size="sm">
                    Manage Periods
                  </Button>
                </Card.Body>
              </Card>
            )}

            {permissions.canInviteCollaborators && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Leadership Team</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Invite collaborators to help manage your alliance.
                  </p>
                  <Button href={`/alliances/${allianceId}/settings/invitations`} variant="primary" size="sm">
                    Manage Team
                  </Button>
                </Card.Body>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
