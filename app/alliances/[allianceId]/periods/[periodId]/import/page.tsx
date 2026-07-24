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

  // The full alliance metric library (active), so the import step can offer to
  // attach an existing metric that simply is not on this period yet.
  const libraryMetrics = await prisma.metric.findMany({
    where: { allianceId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const canConfigureMetrics = auth.permissions.canConfigureMetrics;
  const canConfigurePeriods = auth.permissions.canConfigurePeriods;

  // A metric can be brought into an empty period during import when the user
  // can create metrics, or attach a library metric that isn't on the period.
  const attachableLibraryMetrics = libraryMetrics.filter(
    (m) => !metrics.some((pm) => pm.id === m.id),
  );
  const canProvisionMetrics =
    canConfigureMetrics ||
    (canConfigurePeriods && attachableLibraryMetrics.length > 0);

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
        { label: "Import Evaluation Results" },
      ]
    : [
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Import Evaluation Results" },
      ];

  const hasNoMembers = !alliance || alliance.allianceMembers.length === 0;
  // Only a dead-end when the period has no metrics AND the user can neither
  // create nor attach one during import.
  const hasNoMetrics = metrics.length === 0 && !canProvisionMetrics;

  if (hasNoMetrics || hasNoMembers) {
    return (
      <PageLayout
        breadcrumb={breadcrumb}
        title="Import Evaluation Results"
        description={`Upload a CSV spreadsheet (.csv) to record metric evaluation results for ${period.name}.`}
        maxWidth="md"
      >
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 mb-6 font-medium">
          Destination Period: {period.name}
        </div>
        {hasNoMetrics ? (
          <EmptyState
            title="No metrics configured"
            description="Add metrics to this evaluation period before importing evaluation results."
            action={
              auth.permissions.canConfigurePeriods
                ? <Button variant="primary" href={`/alliances/${allianceId}/periods/${periodId}`}>Manage Period Metrics</Button>
                : undefined
            }
          />
        ) : (
          <EmptyState
            title="No active members"
            description="Import your alliance roster before importing evaluation results."
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
      title="Import Evaluation Results"
      description={`Upload a CSV spreadsheet (.csv) to record metric evaluation results for ${period.name}.`}
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
            periodName={period.name}
            allianceId={allianceId}
            members={alliance.allianceMembers}
            metrics={metrics}
            libraryMetrics={attachableLibraryMetrics}
            canCreateMetrics={canConfigureMetrics}
            canAttachMetrics={canConfigurePeriods}
          />
        </Card.Body>
      </Card>
    </PageLayout>
  );
}
