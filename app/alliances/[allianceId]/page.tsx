import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { PageLayout, Card, Badge, SetupProgressCard } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

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

  // Check for active period with metrics (for Record Metrics card)
  const activePeriod = permissions.canImportMetrics
    ? await prisma.metricPeriod.findFirst({
        where: {
          allianceId,
          active: true,
        },
        include: {
          periodMetrics: {
            where: { metric: { active: true } },
          },
        },
      })
    : null;

  return (
    <PageLayout
      title={alliance.name}
      description={`Server: ${alliance.server}`}
    >
      <div className="flex flex-col gap-6">
        {/* Persistent setup progress: stays until all applicable tasks (required
            and optional next steps) are complete. Visibility handled internally. */}
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
                  Manage your alliance roster and member data.
                </p>
                <Button href={`/alliances/${allianceId}/members`} variant="primary" size="sm">
                  View Members
                </Button>
              </Card.Body>
            </Card>

            {permissions.canImportMetrics && activePeriod && activePeriod.periodMetrics.length > 0 && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Evaluation Results</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Record or import performance data for <strong>{activePeriod.name}</strong>.
                  </p>
                  <div className="flex gap-2">
                    <Button href={`/alliances/${allianceId}/periods/${activePeriod.id}/record`} variant="primary" size="sm">
                      Record Now
                    </Button>
                    <Button href={`/alliances/${allianceId}/periods/${activePeriod.id}/import`} variant="secondary" size="sm">
                      Import Results
                    </Button>
                  </div>
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