import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
import { AddMetricForm } from "./AddMetricForm";
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
        },
        select: {
            id: true,
            name: true,
        },
    });

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
            
            {period.periodMetrics.length === 0 ? (
                <p className="text-gray-500">No metrics have been configured yet. Add the metrics you want leaders to evaluate during this period.</p>
            ) : (
                <ul className="flex flex-col gap-2 w-full max-w-md">
                    {period.periodMetrics.map((pm) => (
                        <li key={pm.metric.id} className="flex items-center justify-between p-3 border rounded-md">
                            <span className="font-medium">{pm.metric.name}</span>
                            <div className="flex items-center gap-3 text-sm text-blue-600">
                            {pm.required && (
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                        Required
                                    </span>
                                )}
                                <span>Weight: {pm.weight}</span>

                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <AddMetricForm metrics={metrics} periodId={period.id} />
        </div>
    );
}