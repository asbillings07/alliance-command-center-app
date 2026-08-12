import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PeriodMetricList } from "./PeriodMetricList";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { PageLayout, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { getPeriodResultsSummary } from "@/app/src/lib/reports/getPeriodResultsSummary";
import { canProvisionMetricsForPeriod } from "@/app/src/lib/periods/canProvisionMetricsForPeriod";
import { evaluateFeature } from "@/app/src/lib/featureFlags/evaluateFeature";
import { resolveEnvironment, toFeatureContext } from "@/app/src/lib/featureFlags/context";

type Params = {
    params: Promise<{
        allianceId: string;
        periodId: string;
    }>
}

export default async function PeriodPage({ params }: Params) {
    const { periodId, allianceId } = await params;

    const auth = await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.VIEW_ALLIANCE,
    });
    const { permissions } = auth;

    const reportsEnabled = await evaluateFeature(
        "reports",
        toFeatureContext({ environment: resolveEnvironment(), authorization: auth })
    );

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

    const resultsSummary = await getPeriodResultsSummary({ allianceId, periodId });

    const metrics = await prisma.metric.findMany({
        where: {
            allianceId,
            active: true,
        },
        select: {
            id: true,
            name: true,
        },
        orderBy: {
            name: "asc",
        },
    });

    const periodMetrics = period.periodMetrics.map((pm) => ({
        metricId: pm.metricId,
        metricName: pm.metric.name,
        weight: pm.weight,
        required: pm.required,
    }));

    const assignedMetricIds = periodMetrics.map((pm) => pm.metricId);
    const attachableLibraryMetricCount = await prisma.metric.count({
        where: {
            allianceId,
            active: true,
            ...(assignedMetricIds.length > 0
                ? { id: { notIn: assignedMetricIds } }
                : {}),
        },
    });
    const hasPeriodMetrics = periodMetrics.length > 0;
    const hasActiveMembers = resultsSummary.currentActiveMemberCount > 0;
    const canProvision = canProvisionMetricsForPeriod({
        canConfigureMetrics: permissions.canConfigureMetrics,
        canConfigurePeriods: permissions.canConfigurePeriods,
        attachableLibraryMetricCount,
    });

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Periods", href: `/alliances/${allianceId}/periods` },
                { label: period.name },
            ]}
            title={period.name}
            maxWidth="3xl"
        >
            <div className="flex flex-col gap-6">
                <Card>
                    <Card.Header>Overview</Card.Header>
                    <Card.Body>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-text-secondary">Start Date:</span>
                                <span className="ml-2 text-primary">
                                    {period.startsAt?.toLocaleDateString() || 'Not Set'}
                                </span>
                            </div>
                            <div>
                                <span className="text-text-secondary">End Date:</span>
                                <span className="ml-2 text-primary">
                                    {period.endsAt?.toLocaleDateString() || 'Not Set'}
                                </span>
                            </div>
                        </div>
                    </Card.Body>
                </Card>

                <Card>
                    <Card.Header>Recorded Results Coverage</Card.Header>
                    <Card.Body>
                        <div className="flex flex-col gap-4">
                            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg flex items-center justify-between">
                                {resultsSummary.currentActiveMemberCount === 0 ? (
                                    <div>
                                        <p className="text-lg font-bold text-text-primary">
                                            No active members yet
                                        </p>
                                        <p className="text-sm text-text-secondary mt-0.5">
                                            Import members before recording evaluation results for this period.
                                        </p>
                                        {permissions.canImportMembers && (
                                            <div className="mt-3">
                                                <Button
                                                    href={`/alliances/${allianceId}/members/import`}
                                                    variant="primary"
                                                    size="sm"
                                                >
                                                    Import Members
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div>
                                            <p className="text-lg font-bold text-text-primary">
                                                {resultsSummary.participatingMemberCount} participating {resultsSummary.participatingMemberCount === 1 ? "member" : "members"}
                                            </p>
                                            <p className="text-sm text-text-secondary mt-0.5">
                                                {resultsSummary.participatingActiveMemberCount} of {resultsSummary.currentActiveMemberCount} current active members have recorded results
                                            </p>
                                        </div>
                                        {permissions.canViewMembers && (
                                            <Button
                                                href={`/alliances/${allianceId}/members?periodId=${periodId}`}
                                                variant="secondary"
                                                size="sm"
                                            >
                                                View Member Results
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>

                            {resultsSummary.metrics.length > 0 && (
                                <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-secondary">
                                    {resultsSummary.metrics.map((m) => (
                                        <li key={m.metricId} className="flex items-center justify-between p-3 text-sm gap-3">
                                            <span className="font-medium text-text-primary">{m.metricName}</span>
                                            <div className="flex items-center gap-3">
                                                <span className="text-text-secondary">
                                                    <strong className="text-text-primary">{m.activeMemberCount}</strong> / {resultsSummary.currentActiveMemberCount} active members
                                                    {m.memberCount > m.activeMemberCount && (
                                                        <span className="text-text-muted text-xs ml-1.5">
                                                            ({m.memberCount} total incl. archived)
                                                        </span>
                                                    )}
                                                </span>
                                                {permissions.canViewMembers && reportsEnabled && (
                                                    <Button
                                                        href={`/alliances/${allianceId}/reports/metrics/${m.metricId}?periodId=${periodId}`}
                                                        variant="link"
                                                        size="sm"
                                                    >
                                                        View Report
                                                    </Button>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </Card.Body>
                </Card>

                <Card>
                    <Card.Header>Configured Metrics</Card.Header>
                    <Card.Body>
                        <PeriodMetricList
                            metrics={metrics}
                            allianceId={allianceId}
                            periodId={period.id}
                            periodMetrics={periodMetrics}
                            readOnly={!permissions.canConfigurePeriods}
                        />
                    </Card.Body>
                </Card>

                {permissions.canImportMetrics && (
                    <Card>
                        <Card.Header>Actions</Card.Header>
                        <Card.Body>
                            {!hasActiveMembers ? (
                                <>
                                    <p className="text-sm text-text-secondary mb-4">
                                        Import members before recording or importing evaluation results.
                                    </p>
                                    {permissions.canImportMembers ? (
                                        <Button
                                            href={`/alliances/${allianceId}/members/import`}
                                            variant="primary"
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
                                        Configure period metrics before recording results.
                                    </p>
                                    {permissions.canConfigurePeriods ? (
                                        <Button
                                            href={`/alliances/${allianceId}/periods/${periodId}`}
                                            variant="primary"
                                        >
                                            Manage Period Metrics
                                        </Button>
                                    ) : (
                                        <Button
                                            href={`/alliances/${allianceId}/periods/${periodId}`}
                                            variant="secondary"
                                        >
                                            View Period
                                        </Button>
                                    )}
                                </>
                            ) : !hasPeriodMetrics && canProvision ? (
                                <>
                                    <p className="text-sm text-text-secondary mb-4">
                                        Import a spreadsheet to attach metrics and add results for this period.
                                    </p>
                                    <Button
                                        href={`/alliances/${allianceId}/periods/${periodId}/import`}
                                        variant="primary"
                                    >
                                        Import Evaluation Results
                                    </Button>
                                </>
                            ) : (
                                <div className="flex gap-4">
                                    <Button
                                        href={`/alliances/${allianceId}/periods/${periodId}/record`}
                                        variant="primary"
                                    >
                                        Record Results
                                    </Button>
                                    <Button
                                        href={`/alliances/${allianceId}/periods/${periodId}/import`}
                                        variant="secondary"
                                    >
                                        Import Evaluation Results
                                    </Button>
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                )}
            </div>
        </PageLayout>
    );
}
