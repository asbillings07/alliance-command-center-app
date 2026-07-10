import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { ImportForm } from "./ImportForm";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
        periodId: string;
    }>;
};

export default async function ImportPage({ params }: Params) {
    const { allianceId, periodId } = await params;
    
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.IMPORT_METRICS,
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

    const metrics = period.periodMetrics.map((pm) => ({
        id: pm.metric.id,
        name: pm.metric.name,
    }));

    const alliance = await prisma.alliance.findUnique({
        where: { id: allianceId },
        select: {
            allianceMembers: {
                where: { archivedAt: null },
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
            <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
                <h1 className="text-2xl font-bold">{period.name}</h1>
                <p className="text-gray-500">
                    No metrics configured for this period. Please add metrics first.
                </p>
                <Link
                    href={`/alliances/${allianceId}/periods/${periodId}`}
                    className="text-blue-500 hover:text-blue-700"
                >
                    ← Back to Period
                </Link>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
            <h1 className="text-2xl font-bold">{period.name}</h1>
            <h2 className="text-lg text-gray-600">Import from Spreadsheet</h2>
            <p className="text-sm text-gray-500 max-w-md text-center">
                Upload any CSV with player data. You choose which columns to import.
            </p>
            
            <div className="flex gap-4 text-sm">
                <Link
                    href={`/alliances/${allianceId}/periods/${periodId}`}
                    className="text-gray-500 hover:text-gray-700"
                >
                    ← Back to Period
                </Link>
                <Link
                    href={`/alliances/${allianceId}/periods/${periodId}/record`}
                    className="text-blue-500 hover:text-blue-700"
                >
                    Manual Entry →
                </Link>
            </div>

            <hr className="w-full max-w-2xl border-gray-200" />

            <ImportForm
                periodId={periodId}
                allianceId={allianceId}
                members={alliance.allianceMembers}
                metrics={metrics}
            />
        </div>
    );
}
