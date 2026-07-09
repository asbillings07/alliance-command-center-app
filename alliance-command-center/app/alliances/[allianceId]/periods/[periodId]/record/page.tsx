import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requirePeriodAccess } from "@/app/src/lib/auth/requirePeriodAccess";
import { prisma } from "@/app/src/lib/prisma";
import { RecordMetricsForm } from "./RecordMetricsForm";
import Link from "next/link";

export default async function PeriodRecordPage({ params }: { params: Promise<{ allianceId: string, periodId: string }> }) {
    const { allianceId, periodId } = await params;
    const user = await requireAuth();
    const { period } = await requirePeriodAccess(periodId, allianceId, user.id);
    
    const metrics = period.periodMetrics.map((pm) => ({
        id: pm.metric.id,
        name: pm.metric.name,
    }));

    const alliance = await prisma.alliance.findUnique({
        where: { id: allianceId },
        select: {
            members: {
                where: { active: true },
                select: {
                    id: true,
                    playerName: true,
                },
                orderBy: { playerName: "asc" },
            },
        },
    });

    if (!alliance || metrics.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <h1 className="text-2xl font-bold">{period.name}</h1>
                <p className="text-gray-500">No metrics configured for this period. Please add metrics first.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
            <h1 className="text-2xl font-bold">{period.name}</h1>
            <h2 className="text-lg text-gray-600">Record Metrics</h2>
            
            <div className="flex gap-4 text-sm">
                <Link
                    href={`/alliances/${allianceId}/periods/${periodId}`}
                    className="text-gray-500 hover:text-gray-700"
                >
                    ← Back to Period
                </Link>
                <Link
                    href={`/alliances/${allianceId}/periods/${periodId}/import`}
                    className="text-blue-500 hover:text-blue-700"
                >
                    Import from Spreadsheet →
                </Link>
            </div>

            <hr className="w-full max-w-2xl border-gray-200" />
            <RecordMetricsForm
                periodId={periodId}
                allianceId={allianceId}
                members={alliance.members}
                metrics={metrics}
            />
        </div>
    );
}