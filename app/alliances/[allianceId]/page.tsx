import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { PageLayout, Card, Button, Badge } from "@/app/src/components";

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

  let activePeriod: { id: string; name: string } | null = null;
  if (permissions.canImportMetrics && !permissions.canConfigurePeriods) {
    const period = await prisma.metricPeriod.findFirst({
      where: { allianceId, active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    });
    activePeriod = period;
  }

  return (
    <PageLayout
      title={alliance.name}
      description={`Server: ${alliance.server}`}
    >
      <div className="flex flex-col gap-6">
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

            {permissions.canImportMetrics && !permissions.canConfigurePeriods && (
              <Card>
                <Card.Body>
                  <h3 className="font-medium text-primary mb-2">Record Metrics</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    {activePeriod 
                      ? `Record data for ${activePeriod.name}.`
                      : "No active evaluation period available."
                    }
                  </p>
                  {activePeriod ? (
                    <Button 
                      href={`/alliances/${allianceId}/periods/${activePeriod.id}/record`} 
                      variant="primary" 
                      size="sm"
                    >
                      Record Now
                    </Button>
                  ) : (
                    <span className="text-sm text-text-muted">
                      Waiting for period activation
                    </span>
                  )}
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