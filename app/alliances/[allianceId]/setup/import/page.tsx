import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PageLayout, Card, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { SetupImportForm } from "./SetupImportForm";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

export default async function SetupImportPage({ params }: Params) {
  const { allianceId } = await params;

  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  const [alliance, activePeriodCount, archivedPeriodCount, members, alliancePeriodsRaw, libraryMetrics] =
    await Promise.all([
      prisma.alliance.findUnique({
        where: { id: allianceId },
        select: { id: true, name: true },
      }),
      prisma.metricPeriod.count({ where: { allianceId, active: true } }),
      prisma.metricPeriod.count({ where: { allianceId, active: false } }),
      prisma.allianceMember.findMany({
        where: { allianceId, archivedAt: null },
        select: { id: true, playerName: true },
        orderBy: { playerName: "asc" },
      }),
      prisma.metricPeriod.findMany({
        where: { allianceId, active: true },
        select: {
          id: true,
          name: true,
          startsAt: true,
          endsAt: true,
          periodMetrics: {
            where: { active: true },
            select: {
              metric: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ startsAt: "asc" }, { name: "asc" }],
      }),
      prisma.metric.findMany({
        where: { allianceId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

  if (!alliance) {
    notFound();
  }

  const hasArchivedPeriodsOnly = activePeriodCount === 0 && archivedPeriodCount > 0;
  const canConfigureMetrics = auth.permissions.canConfigureMetrics;
  const canConfigurePeriods = auth.permissions.canConfigurePeriods;

  const alliancePeriods = alliancePeriodsRaw.map((period) => ({
    id: period.id,
    name: period.name,
    startsAt: period.startsAt?.toISOString() ?? null,
    endsAt: period.endsAt?.toISOString() ?? null,
    metrics: period.periodMetrics.map((pm) => ({
      id: pm.metric.id,
      name: pm.metric.name,
    })),
  }));

  const setupImportReturnTo = `/alliances/${allianceId}/setup/import`;

  if (members.length === 0) {
    return (
      <PageLayout
        breadcrumb={[
          { label: "Dashboard", href: `/alliances/${allianceId}` },
          { label: "Setup", href: `/alliances/${allianceId}/setup` },
          { label: "Import Spreadsheet" },
        ]}
        title="Import Evaluation Results"
        description="Upload your existing spreadsheet to populate evaluation periods, metrics, and member results."
        maxWidth="md"
      >
        <EmptyState
          title="Import members first"
          description="Alliance Command Center handles member rosters and evaluation results as separate uploads in this version. Import your member list first, then return here to upload evaluation results."
          action={
            auth.permissions.canImportMembers ? (
              <Button
                variant="primary"
                href={`/alliances/${allianceId}/members/import?returnTo=${encodeURIComponent(setupImportReturnTo)}`}
              >
                Import Members
              </Button>
            ) : (
              <Button variant="secondary" href={`/alliances/${allianceId}/setup`}>
                Back to Setup
              </Button>
            )
          }
        />
        {!auth.permissions.canImportMembers && (
          <p className="mt-4 text-sm text-text-muted text-center">
            Ask an Admin or Owner to import members before you can import evaluation results.
          </p>
        )}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      breadcrumb={[
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Setup", href: `/alliances/${allianceId}/setup` },
        { label: "Import Spreadsheet" },
      ]}
      title="Import Evaluation Results"
      description="Upload your existing spreadsheet to detect evaluation periods and import member results."
      maxWidth="2xl"
    >
      <Card>
        <Card.Body>
          <SetupImportForm
            allianceId={allianceId}
            alliancePeriods={alliancePeriods}
            allianceLibraryMetrics={libraryMetrics}
            members={members}
            canCreateMetrics={canConfigureMetrics}
            canAttachMetrics={canConfigurePeriods}
            canConfigurePeriods={canConfigurePeriods}
            hasArchivedPeriodsOnly={hasArchivedPeriodsOnly}
          />
        </Card.Body>
      </Card>
    </PageLayout>
  );
}
