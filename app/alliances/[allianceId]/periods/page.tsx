import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { MetricPeriodCard } from "./metricPeriodCard";
import { PageLayout, EmptyState } from "@/app/src/components";
import { TourButton, TourAutoStart } from "@/app/src/components/client";
import { createPeriodTour } from "@/app/src/lib/tours";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function PeriodsPage({ params }: Params) {
    const { allianceId } = await params;
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.CONFIGURE_PERIODS,
    });

    const periods = await prisma.metricPeriod.findMany({
        where: {
            allianceId: allianceId,
        },
        orderBy: {
            createdAt: "desc",
        },
        include: {
            periodMetrics: {
                include: {
                    metric: true,
                },
            },
        },
    });

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Evaluation Periods" },
            ]}
            title="Evaluation Periods"
            description="Create and manage evaluation periods for tracking member performance"
            action={<TourButton tour={createPeriodTour} />}
            maxWidth="3xl"
        >
            <TourAutoStart />
            <div className="flex flex-col gap-4">
                <MetricPeriodCard allianceId={allianceId} mode="create" />
                {periods.length === 0 ? (
                    <EmptyState
                        title="No evaluation periods"
                        description="Evaluation periods are time-boxed windows for tracking member performance. Create a period (e.g., 'Week 1' or 'June Evaluation'), assign your metrics to it, then record or import data for each member."
                    />
                ) : (
                    periods.map((period) => (
                        <MetricPeriodCard
                            key={period.id}
                            allianceId={allianceId}
                            mode="view"
                            period={{
                                id: period.id,
                                name: period.name,
                                startsAt: period.startsAt?.toISOString().split('T')[0] || null,
                                endsAt: period.endsAt?.toISOString().split('T')[0] || null,
                                active: period.active,
                                periodKey: `${period.id}-${period.createdAt.getTime()}`,
                                periodMetrics: period.periodMetrics,
                            }}
                        />
                    ))
                )}
            </div>
        </PageLayout>
    );
}