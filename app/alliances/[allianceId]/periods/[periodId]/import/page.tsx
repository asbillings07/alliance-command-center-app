import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { ImportForm } from "./ImportForm";
import { PageLayout, Card, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
  params: Promise<{
    allianceId: string;
    periodId: string;
  }>;
};

export default async function ImportPage({ params }: Params) {
  const { allianceId, periodId } = await params;

  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
    include: {
      periodMetrics: {
        where: { active: true },
        include: { metric: true },
      },
    },
  });

  if (!period) {
    notFound();
  }

  const metrics = period.periodMetrics.map((pm) => ({
    id: pm.metric.id,
    name: pm.metric.name,
  }));

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: {
      allianceMembers: {
        where: { archivedAt: null },
        select: {
          id: true,
          playerName: true,
        },
        orderBy: { playerName: "asc" },
      },
    },
  });

  const breadcrumb = auth.permissions.canConfigurePeriods
    ? [
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Periods", href: `/alliances/${allianceId}/periods` },
        { label: period.name, href: `/alliances/${allianceId}/periods/${periodId}` },
        { label: "Import" },
      ]
    : [
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Import Metrics" },
      ];

  const hasNoMembers = !alliance || alliance.allianceMembers.length === 0;
  const hasNoMetrics = metrics.length === 0;

  if (hasNoMetrics || hasNoMembers) {
    return (
      <PageLayout
        breadcrumb={breadcrumb}
        title={period.name}
        description="Import from Spreadsheet"
        maxWidth="md"
      >
        {hasNoMetrics ? (
          <EmptyState
            title="No metrics configured"
            description="Add metrics to this evaluation period before importing data."
            action={
              auth.permissions.canConfigurePeriods
                ? <Button variant="primary" href={`/alliances/${allianceId}/periods/${periodId}`}>Configure Metrics</Button>
                : undefined
            }
          />
        ) : (
          <EmptyState
            title="No active members"
            description="Import your alliance roster before importing metrics."
            action={
              auth.permissions.canImportMembers
                ? <Button variant="primary" href={`/alliances/${allianceId}/members/import`}>Import Members</Button>
                : undefined
            }
          />
        )}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      breadcrumb={breadcrumb}
      title={period.name}
      description="Upload any CSV with player data. You choose which columns to import."
      action={
        <Button
          href={`/alliances/${allianceId}/periods/${periodId}/record`}
          variant="secondary"
          size="sm"
        >
          Manual Entry
        </Button>
      }
      maxWidth="2xl"
    >
      <Card>
        <Card.Body>
          <ImportForm
            periodId={periodId}
            allianceId={allianceId}
            members={alliance.allianceMembers}
            metrics={metrics}
          />
        </Card.Body>
      </Card>
    </PageLayout>
  );
}
