import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { MetricCard } from "./metricCard";
import { PageLayout, EmptyState } from "@/app/src/components";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function MetricsPage({ params }: Params) {
    const { allianceId } = await params;
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.CONFIGURE_METRICS,
    });
    const metrics = await prisma.metric.findMany({
        where: {
            allianceId: allianceId,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Metrics Library" },
            ]}
            title="Metrics Library"
            description="Define the metrics you track for your alliance"
            maxWidth="3xl"
        >
            <div className="flex flex-col gap-4">
                <MetricCard allianceId={allianceId} mode="create" />
                {metrics.length === 0 ? (
                    <EmptyState
                        title="No metrics yet"
                        description="Create your first metric to start tracking alliance performance."
                    />
                ) : (
                    metrics.map((metric) => (
                        <MetricCard
                            key={metric.id}
                            allianceId={allianceId}
                            mode="view"
                            metric={{
                                id: metric.id,
                                name: metric.name,
                                description: metric.description,
                                type: metric.type,
                                active: metric.active,
                                metricKey: `${metric.id}-${metric.createdAt.getTime()}`,
                            }}
                        />
                    ))
                )}
            </div>
        </PageLayout>
    );
}