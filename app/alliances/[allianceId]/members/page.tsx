import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import Link from "next/link";
import { formatPower } from "@/app/src/lib/formatPower";
import { MembersFilter } from "./MembersFilter";
import { PageLayout, Card, Badge, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
    searchParams: Promise<{
        filter?: string;
        periodId?: string;
    }>;
};

type FilterType = "active" | "archived" | "all";

function isValidFilter(filter: string | undefined): filter is FilterType {
    return filter === "active" || filter === "archived" || filter === "all";
}

type PeriodMetricColumn = {
    metricId: string;
    metricName: string;
};

export default async function MembersPage({ params, searchParams }: Params) {
    const { allianceId } = await params;
    const { filter: filterParam, periodId } = await searchParams;
    
    const filter: FilterType = isValidFilter(filterParam) ? filterParam : "active";

    const authContext = await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.VIEW_MEMBERS,
    });

    const alliance = await prisma.alliance.findUnique({
        where: {
            id: allianceId,
        },
    });

    if (!alliance) {
        redirect("/app");
    }

    const whereClause = {
        allianceId: allianceId,
        ...(filter === "active" ? { archivedAt: null } : {}),
        ...(filter === "archived" ? { archivedAt: { not: null } } : {}),
    };

    const allianceMembers = await prisma.allianceMember.findMany({
        where: whereClause,
        orderBy: {
            playerName: "asc",
        },
    });

    const selectedPeriod = periodId
        ? await prisma.metricPeriod.findFirst({
            where: { id: periodId, allianceId },
            select: {
                id: true,
                name: true,
                periodMetrics: {
                    where: { active: true },
                    select: {
                        metricId: true,
                        metric: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                    orderBy: {
                        metric: { name: "asc" },
                    },
                },
            },
        })
        : null;

    const selectedPeriodId = selectedPeriod?.id;

    const periodMetricColumns: PeriodMetricColumn[] =
        selectedPeriod?.periodMetrics.map((pm) => ({
            metricId: pm.metricId,
            metricName: pm.metric.name,
        })) ?? [];

    const periodMetricIds = periodMetricColumns.map((metric) => metric.metricId);
    const memberIds = allianceMembers.map((member) => member.id);
    const periodMetricEntries =
        selectedPeriod && periodMetricIds.length > 0 && memberIds.length > 0
            ? await prisma.memberMetricEntry.findMany({
                where: {
                    periodId: selectedPeriod.id,
                    metricId: { in: periodMetricIds },
                    allianceMemberId: { in: memberIds },
                    allianceMember: { allianceId },
                },
                select: {
                    allianceMemberId: true,
                    metricId: true,
                    value: true,
                    recordedAt: true,
                    createdAt: true,
                    id: true,
                },
                orderBy: [
                    { recordedAt: "desc" },
                    { createdAt: "desc" },
                    { id: "desc" },
                ],
            })
            : [];

    const latestMetricValueByMemberAndMetric = new Map<string, number>();
    for (const entry of periodMetricEntries) {
        const key = `${entry.allianceMemberId}:${entry.metricId}`;
        if (!latestMetricValueByMemberAndMetric.has(key)) {
            latestMetricValueByMemberAndMetric.set(key, entry.value);
        }
    }

    const [activeCount, archivedCount] = await Promise.all([
        prisma.allianceMember.count({
            where: { allianceId, archivedAt: null },
        }),
        prisma.allianceMember.count({
            where: { allianceId, archivedAt: { not: null } },
        }),
    ]);

    const { permissions } = authContext;

    const description = `${allianceMembers.length} member${allianceMembers.length !== 1 ? "s" : ""}${filter !== "all" ? ` (${filter})` : ""}${selectedPeriod ? ` · ${selectedPeriod.name} results` : ""}`;

    const actionButtons = (
        <div className="flex gap-3">
            {permissions.canImportMembers && (
                <Button
                    variant="secondary"
                    size="sm"
                    href={`/alliances/${allianceId}/members/import`}
                >
                    Import Members
                </Button>
            )}
            {permissions.canManageMembers && (
                <Button
                    variant="primary"
                    size="sm"
                    href={`/alliances/${allianceId}/members/new`}
                >
                    Add Member
                </Button>
            )}
        </div>
    );

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Members" },
            ]}
            title={`${alliance.name} Roster`}
            description={description}
            action={actionButtons}
        >
            <MembersFilter
                currentFilter={filter}
                activeCount={activeCount}
                archivedCount={archivedCount}
                allianceId={allianceId}
                periodId={selectedPeriodId}
            />

            {allianceMembers.length === 0 ? (
                <EmptyState
                    title={
                        filter === "active"
                            ? "No active members yet"
                            : filter === "archived"
                            ? "No archived members"
                            : "No members yet"
                    }
                    description={
                        filter === "active"
                            ? permissions.canManageMembers
                                ? "Import members or add them manually to get started."
                                : "The alliance member list hasn't been set up yet. An admin will import members soon."
                            : filter === "archived"
                            ? "Members that have been archived will appear here."
                            : undefined
                    }
                    action={
                        filter === "active" && permissions.canManageMembers
                            ? <Button variant="primary" href={`/alliances/${allianceId}/members/new`}>Add Member</Button>
                            : undefined
                    }
                />
            ) : (
                <Card>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-surface-secondary border-b border-border">
                                <tr>
                                    <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                        Player
                                    </th>
                                    {periodMetricColumns.map((metric) => (
                                        <th
                                            key={metric.metricId}
                                            className="text-right px-4 py-3 text-sm font-medium text-text-secondary whitespace-nowrap"
                                        >
                                            {metric.metricName}
                                        </th>
                                    ))}
                                    <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                        THP
                                    </th>
                                    <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                        Squad Power
                                    </th>
                                    <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                        Role
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {allianceMembers.map((member) => {
                                    const memberHref = `/alliances/${allianceId}/members/${member.id}${selectedPeriodId ? `?periodId=${encodeURIComponent(selectedPeriodId)}` : ""}`;

                                    return (
                                        <tr
                                            key={member.id}
                                            className="border-b border-border hover:bg-surface-secondary transition-colors cursor-pointer"
                                        >
                                            <td className="p-0">
                                                <Link
                                                    href={memberHref}
                                                    className="block px-4 py-3 font-medium text-primary-light hover:text-primary"
                                                >
                                                    {member.playerName}
                                                    {member.archivedAt && (
                                                        <Badge variant="neutral" size="sm" className="ml-2">
                                                            Archived
                                                        </Badge>
                                                    )}
                                                </Link>
                                            </td>
                                            {periodMetricColumns.map((metric) => {
                                                const value = latestMetricValueByMemberAndMetric.get(`${member.id}:${metric.metricId}`);

                                                return (
                                                    <td key={metric.metricId} className="p-0 text-right">
                                                        <Link
                                                            href={memberHref}
                                                            className="block px-4 py-3 text-text-primary font-medium whitespace-nowrap"
                                                            aria-label={`${member.playerName} ${metric.metricName}`}
                                                        >
                                                            {value == null ? "—" : formatPower(value)}
                                                        </Link>
                                                    </td>
                                                );
                                            })}
                                            <td className="p-0 text-right">
                                                <Link
                                                    href={memberHref}
                                                    className="block px-4 py-3 text-text-secondary whitespace-nowrap"
                                                    aria-label={`${member.playerName} THP`}
                                                >
                                                    {member.thp == null ? "—" : formatPower(member.thp)}
                                                </Link>
                                            </td>
                                            <td className="p-0 text-right">
                                                <Link
                                                    href={memberHref}
                                                    className="block px-4 py-3 text-text-secondary whitespace-nowrap"
                                                    aria-label={`${member.playerName} Squad Power`}
                                                >
                                                    {member.squadPower == null ? "—" : formatPower(member.squadPower)}
                                                </Link>
                                            </td>
                                            <td className="p-0">
                                                <Link
                                                    href={memberHref}
                                                    className="block px-4 py-3 text-text-secondary whitespace-nowrap"
                                                    aria-label={`${member.playerName} Role`}
                                                >
                                                    {member.role || "—"}
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </PageLayout>
    );
}
