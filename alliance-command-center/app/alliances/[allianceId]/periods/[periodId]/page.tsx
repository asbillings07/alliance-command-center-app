import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";

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

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <h1 className="text-2xl font-bold">Period: {period.name}</h1>
            <h2>Starts At: {period.startsAt?.toLocaleDateString() || 'Not Set'}</h2>
            <h2>Ends At: {period.endsAt?.toLocaleDateString() || 'Not Set'}</h2>
            <h2>Configured Metrics:</h2>
            {period.periodMetrics.length === 0 ? (
                <p>No metrics configured for this period</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {period.periodMetrics.map(({ metric }) => (
                        <li key={metric.id}>
                            {metric.name}
                        </li>
                    ))}
                </ul>
            )}
            <button className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Add Metric</button>
        </div>
    );
}