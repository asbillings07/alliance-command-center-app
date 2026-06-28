import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { MetricPeriodCard } from "./metricPeriodCard";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function PeriodsPage({ params }: Params) {
    const { allianceId } = await params;
    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

    const periods = await prisma.metricPeriod.findMany({
        where: {
            allianceId: allianceId,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <h1 className="text-2xl font-bold">Metric Periods</h1>
            <div className="flex flex-col items-center justify-center gap-4 w-full max-w-3xl">
                <MetricPeriodCard allianceId={allianceId} mode="create" />
                {periods.length === 0 ? (
                    <p className="text-gray-500">No periods found. Create one to get started!</p>
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
                            }}
                        />
                    ))
                )}
            </div>
        </div>
    );
}