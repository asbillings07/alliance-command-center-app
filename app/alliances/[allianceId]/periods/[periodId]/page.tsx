import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PeriodMetricList } from "./PeriodMetricList";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { PageLayout, Card, Button } from "@/app/src/components";

type Params = {
    params: Promise<{
        allianceId: string;
        periodId: string;
    }>
}

export default async function PeriodPage({ params }: Params) {
    const { periodId, allianceId } = await params;
    
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.CONFIGURE_PERIODS,
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
                    <Card.Header>Configured Metrics</Card.Header>
                    <Card.Body>
                        <PeriodMetricList
                            metrics={metrics}
                            allianceId={allianceId}
                            periodId={period.id}
                            periodMetrics={periodMetrics}
                        />
                    </Card.Body>
                </Card>

                <Card>
                    <Card.Header>Actions</Card.Header>
                    <Card.Body>
                        <div className="flex gap-4">
                            <Button
                                href={`/alliances/${allianceId}/periods/${periodId}/record`}
                                variant="primary"
                            >
                                Record Metrics
                            </Button>
                            <Button
                                href={`/alliances/${allianceId}/periods/${periodId}/import`}
                                variant="secondary"
                            >
                                Import from Spreadsheet
                            </Button>
                        </div>
                    </Card.Body>
                </Card>
            </div>
        </PageLayout>
    );
}