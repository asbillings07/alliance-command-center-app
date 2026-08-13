import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { resolveTargetPeriod } from "@/app/src/lib/periods/resolveTargetPeriod";
import { canProvisionMetricsForPeriod } from "@/app/src/lib/periods/canProvisionMetricsForPeriod";
import { evaluateFeature } from "@/app/src/lib/featureFlags/evaluateFeature";
import { resolveEnvironment, toFeatureContext } from "@/app/src/lib/featureFlags/context";
import { getRosterHealthSummary, type RosterHealthSummary } from "@/app/src/lib/dashboard/getRosterHealthSummary";
import { getDashboardFindingsSummary } from "@/app/src/lib/dashboard/getDashboardFindingsSummary";
import { buildDashboardWorkflowViewModel } from "./dashboardWorkflowViewModel";
import { LegacyDashboard } from "./LegacyDashboard";
import { WorkflowDashboard } from "./WorkflowDashboard";
import { PageLayout, Badge, SetupProgressCard } from "@/app/src/components";

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

/**
 * Non-critical dashboard additions (roster recency, needs-attention count)
 * degrade independently of the page itself (#332 §4 launch contract): a
 * failure here omits that one section instead of failing the whole
 * dashboard. Tagged `dashboard.section.degraded` so the failure count is a
 * concrete rollout-observability metric, not just an unlabeled exception.
 */
async function loadRosterHealthOrDegrade(allianceId: string): Promise<{
  health: RosterHealthSummary | null;
  degraded: boolean;
}> {
  try {
    return { health: await getRosterHealthSummary(allianceId), degraded: false };
  } catch (error) {
    Sentry.captureException(error, { tags: { "dashboard.section.degraded": "roster-health" } });
    return { health: null, degraded: true };
  }
}

async function loadFindingsSummaryOrDegrade(
  allianceId: string,
  periodId: string,
): Promise<{ actionableFindingCount: number | null; degraded: boolean }> {
  try {
    const summary = await getDashboardFindingsSummary({ allianceId, periodId });
    return { actionableFindingCount: summary.actionableFindingCount, degraded: false };
  } catch (error) {
    Sentry.captureException(error, { tags: { "dashboard.section.degraded": "findings-summary" } });
    return { actionableFindingCount: null, degraded: true };
  }
}

export default async function AlliancePage({ params }: Params) {
  const { allianceId } = await params;
  if (!allianceId) {
    redirect("/app");
  }

  // Authorization runs before anything else - including flag evaluation -
  // so a wrong-alliance or unauthorized request is denied regardless of
  // flag state (#332 AC).
  const auth = await requireAllianceAccess({ allianceId });
  const { permissions } = auth;

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
  });

  if (!alliance) {
    redirect("/app");
  }

  const setupStatus = await getAllianceSetupStatus(allianceId, permissions);

  const reportsEnabled = await evaluateFeature(
    "reports",
    toFeatureContext({ environment: resolveEnvironment(), authorization: auth })
  );

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

  // Evaluated once, at this page boundary, using trusted alliance/user
  // context (#332 implementation constraint) - never re-evaluated per
  // card, and never passed a raw route param.
  const workflowGroupsEnabled = await evaluateFeature(
    "dashboard-workflow-groups",
    toFeatureContext({ environment: resolveEnvironment(), authorization: auth }),
  );

  const setupProgressCard = (
    <SetupProgressCard
      allianceId={allianceId}
      completedCount={setupStatus.completedCount}
      totalCount={setupStatus.totalCount}
      recommendedTask={setupStatus.recommendedTask}
    />
  );

  if (!workflowGroupsEnabled) {
    return (
      <PageLayout title={alliance.name} description={`Server: ${alliance.server}`}>
        <LegacyDashboard
          allianceId={allianceId}
          role={auth.membership.role}
          permissions={permissions}
          setupStatus={setupStatus}
          activePeriod={activePeriod}
          hasPeriodMetrics={hasPeriodMetrics}
          hasActiveMembers={hasActiveMembers}
          canProvision={canProvision}
          reportsEnabled={reportsEnabled}
        />
      </PageLayout>
    );
  }

  // Only fetched for the enabled variant - the disabled path above never
  // pays for these additional reads (#332: no route/action/cost unique to
  // the new variant leaks while disabled).
  const { health: rosterHealth, degraded: rosterHealthDegraded } = await loadRosterHealthOrDegrade(allianceId);
  const { actionableFindingCount, degraded: findingsDegraded } =
    activePeriod && hasPeriodMetrics
      ? await loadFindingsSummaryOrDegrade(allianceId, activePeriod.id)
      : { actionableFindingCount: null, degraded: false };

  const viewModel = buildDashboardWorkflowViewModel({
    role: auth.membership.role,
    permissions,
    hasArchivedPeriodsOnly: setupStatus.hasArchivedPeriodsOnly,
    activePeriod: activePeriod ? { id: activePeriod.id, name: activePeriod.name } : null,
    hasActiveMembers,
    hasPeriodMetrics,
    canProvision,
    reportsEnabled,
    rosterHealth,
    rosterHealthDegraded,
    actionableFindingCount,
    findingsDegraded,
  });

  return (
    <PageLayout
      title={alliance.name}
      description={`Server: ${alliance.server}`}
      action={<Badge variant="info">{auth.membership.role}</Badge>}
    >
      <WorkflowDashboard allianceId={allianceId} viewModel={viewModel} setupProgressCard={setupProgressCard} />
    </PageLayout>
  );
}
