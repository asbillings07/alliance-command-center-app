import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { MetricCard } from "./metricCard";

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
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <h1 className="text-2xl font-bold">Metrics Library</h1>
            <div className="flex flex-col items-center justify-center gap-4 w-full max-w-3xl">
                <MetricCard allianceId={allianceId} mode="create" />
                {metrics.length === 0 ? (
                    <p className="text-gray-500">No metrics found. Create one to get started!</p>
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
        </div>
    );
}