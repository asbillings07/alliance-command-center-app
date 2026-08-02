import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { validateSetupPeriodReturnTo } from "@/app/src/lib/setup/validateSetupPeriodReturnTo";
import { resolveTargetPeriod } from "@/app/src/lib/periods/resolveTargetPeriod";
import { isFeatureEnabled } from "@/app/src/lib/features";
import { MetricCard } from "./metricCard";
import { PageLayout, EmptyState } from "@/app/src/components";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
    searchParams: Promise<{
        returnTo?: string;
    }>;
}

export default async function MetricsPage({ params, searchParams }: Params) {
    const { allianceId } = await params;
    const { returnTo: rawReturnTo } = await searchParams;
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.CONFIGURE_METRICS,
    });
    const returnTo = validateSetupPeriodReturnTo(rawReturnTo, allianceId);
    const targetPeriod = await resolveTargetPeriod(allianceId);
    const showReportLink = isFeatureEnabled("reports");
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
                <MetricCard
                    allianceId={allianceId}
                    mode="create"
                    returnTo={returnTo ?? undefined}
                    targetPeriodId={targetPeriod?.id ?? null}
                />
                {metrics.length === 0 ? (
                    <EmptyState
                        title="No metrics configured"
                        description="Metrics define what you track for your members. Common examples include VS Points, Donation contributions, Arms race participation, and Event attendance. Start by creating the metrics that matter most to your alliance."
                    />
                ) : (
                    metrics.map((metric) => (
                        <MetricCard
                            key={metric.id}
                            allianceId={allianceId}
                            mode="view"
                            showReportLink={showReportLink}
                            metric={{
                                id: metric.id,
                                name: metric.name,
                                description: metric.description,
                                type: metric.type,
                                summaryKind: metric.summaryKind,
                                unitLabel: metric.unitLabel,
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