import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { prisma } from "@/app/src/lib/prisma";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { MetricCard } from "./metricCard";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function MetricsPage({ params }: Params) {
    const { allianceId } = await params;
    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);
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