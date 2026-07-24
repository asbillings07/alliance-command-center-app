import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { RecordMetricsForm } from "./RecordMetricsForm";
import { PageLayout, Card, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

export default async function PeriodRecordPage({
  params,
}: {
  params: Promise<{ allianceId: string; periodId: string }>;
}) {
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
        { label: "Record" },
      ]
    : [
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Record Results" },
      ];

  const hasNoMembers = !alliance || alliance.allianceMembers.length === 0;
  const hasNoMetrics = metrics.length === 0;

  if (hasNoMetrics || hasNoMembers) {
    return (
      <PageLayout
        breadcrumb={breadcrumb}
        title={period.name}
        description="Record Results"
        maxWidth="md"
      >
        {hasNoMetrics ? (
          <EmptyState
            title="No metrics configured"
            description="Add metrics to this evaluation period before recording data."
            action={
              auth.permissions.canConfigurePeriods
                ? <Button variant="primary" href={`/alliances/${allianceId}/periods/${periodId}`}>Configure Metrics</Button>
                : undefined
            }
          />
        ) : (
          <EmptyState
            title="No active members"
            description="Import your alliance roster before recording results."
            action={
              auth.permissions.canImportMembers
                ? <Button variant="primary" href={`/alliances/${allianceId}/members/import`}>Import Roster</Button>
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
      description="Record Results"
      action={
        <Button
          href={`/alliances/${allianceId}/periods/${periodId}/import`}
          variant="secondary"
          size="sm"
        >
          Import Evaluation Results
        </Button>
      }
      maxWidth="2xl"
    >
      <Card>
        <Card.Body>
          <RecordMetricsForm
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