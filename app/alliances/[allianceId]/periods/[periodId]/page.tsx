import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PeriodMetricList } from "./PeriodMetricList";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { PageLayout, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { getPeriodResultsSummary } from "@/app/src/lib/reports/getPeriodResultsSummary";

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
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                                <div>
                                    <p className="text-lg font-bold text-blue-900">
                                        {resultsSummary.participatingMemberCount} participating {resultsSummary.participatingMemberCount === 1 ? "member" : "members"}
                                    </p>
                                    <p className="text-sm text-blue-800 mt-0.5">
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
                            </div>

                            {resultsSummary.metrics.length > 0 && (
                                <ul className="divide-y divide-gray-200 border rounded-lg overflow-hidden">
                                    {resultsSummary.metrics.map((m) => (
                                        <li key={m.metricId} className="flex items-center justify-between p-3 text-sm">
                                            <span className="font-medium text-gray-900">{m.metricName}</span>
                                            <span className="text-gray-700">
                                                <strong>{m.activeMemberCount}</strong> / {resultsSummary.currentActiveMemberCount} active members
                                                {m.memberCount > m.activeMemberCount && (
                                                    <span className="text-gray-500 text-xs ml-1.5">
                                                        ({m.memberCount} total incl. archived)
                                                    </span>
                                                )}
                                            </span>
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
                        </Card.Body>
                    </Card>
                )}
            </div>
        </PageLayout>
    );
}
