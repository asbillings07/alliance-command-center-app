import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
import { PeriodMetricList } from "./PeriodMetricList";
import { prisma } from "@/app/src/lib/prisma";

type Params = {
    params: Promise<{
        allianceId: string;
        periodId: string;
    }>
}

export default async function PeriodPage({ params }: Params) {
    const { periodId } = await params;
    const user = await requireAuth();
    const { period } = await requirePeriodAccess(periodId, user.id);
    const metrics = await prisma.metric.findMany({
        where: {
            allianceId: period.allianceId,
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
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <h1 className="text-2xl font-bold">Evaluation Period: {period.name}</h1>
            <p>──────────────────────────────────────────────────────</p>
            <div className="flex flex-col items-center justify-center gap-2">
                <h2>Overview:</h2>
                <h2>Starts: {period.startsAt?.toLocaleDateString() || 'Not Set'}</h2>
                <h2>Ends: {period.endsAt?.toLocaleDateString() || 'Not Set'}</h2>
                <p>──────────────────────────────────────────────────────</p>
            </div>
            <h2>Configured Metrics:</h2>
            
            <PeriodMetricList
                metrics={metrics}
                periodId={period.id}
                periodMetrics={periodMetrics}
            />
        </div>
    );
}