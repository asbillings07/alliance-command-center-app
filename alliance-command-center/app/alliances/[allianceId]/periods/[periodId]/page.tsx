import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PeriodMetricList } from "./PeriodMetricList";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
        periodId: string;
    }>
}

export default async function PeriodPage({ params }: Params) {
    const { periodId, allianceId } = await params;
    
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.CONFIGURE_PERIODS,
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

    const metrics = await prisma.metric.findMany({
        where: {
            allianceId,
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
            <hr className="w-full max-w-3xl border-gray-200" />
            <div className="flex flex-col items-center justify-center gap-2">
                <h2>Overview:</h2>
                <h2>Starts: {period.startsAt?.toLocaleDateString() || 'Not Set'}</h2>
                <h2>Ends: {period.endsAt?.toLocaleDateString() || 'Not Set'}</h2>
            </div>
            <hr className="w-full max-w-3xl border-gray-200" />
            <h2>Configured Metrics:</h2>
            
            <PeriodMetricList
                metrics={metrics}
                allianceId={allianceId}
                periodId={period.id}
                periodMetrics={periodMetrics}
            />
            <hr className="w-full max-w-3xl border-gray-200" />
            <h2>Actions:</h2>
            <div className="flex gap-4">
                <Link href={`/alliances/${allianceId}/periods/${periodId}/record`} className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Record Metrics</Link>
                <Link href={`/alliances/${allianceId}/periods/${periodId}/import`} className="bg-green-500 text-white rounded-md p-2 cursor-pointer">Import from Spreadsheet</Link>
            </div>
        </div>
    );
}