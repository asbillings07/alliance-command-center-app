import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { metricPeriodChronologicalOrderBy } from "@/app/src/lib/metricPeriodOrdering";
import Link from "next/link";
import { formatPower } from "@/app/src/lib/formatPower";
import { MembersFilter } from "./MembersFilter";
import { MembersPeriodSelector } from "./MembersPeriodSelector";
import {
  isActiveMemberPrerequisiteEmptyState,
  resolveMembersContextualBanner,
} from "./membersPageContextualState";
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
    const setupStatus = await getAllianceSetupStatus(allianceId, permissions);

    const allPeriods = await prisma.metricPeriod.findMany({
        where: { allianceId },
        orderBy: metricPeriodChronologicalOrderBy,
        select: { id: true, name: true, active: true },
    });
    const totalPeriodCount = allPeriods.length;
    const requestedPeriodId = periodId;
    const hasResultsInView =
        periodMetricColumns.length > 0 &&
        allianceMembers.some((member) =>
            periodMetricColumns.some((metric) =>
                latestMetricValueByMemberAndMetric.has(`${member.id}:${metric.metricId}`),
            ),
        );
    const contextualBanner = resolveMembersContextualBanner({
        filter,
        activeMemberCount: activeCount,
        totalPeriodCount,
        requestedPeriodId,
        selectedPeriodId,
        periodMetricCount: periodMetricColumns.length,
        hasResultsInView,
    });
    const showingActiveMemberPrerequisite = isActiveMemberPrerequisiteEmptyState(
        filter,
        activeCount,
        allianceMembers.length,
    );

    const rosterHref = `/alliances/${allianceId}/members?filter=${filter}`;

    const description = `${allianceMembers.length} member${allianceMembers.length !== 1 ? "s" : ""}${filter !== "all" ? ` (${filter})` : ""}${selectedPeriod ? ` · ${selectedPeriod.name} results` : ""}`;

    const periodResultsActions =
        setupStatus.activeMemberCount > 0 && permissions.canImportMetrics && selectedPeriod ? (
            <div className="mt-3 flex gap-3 flex-wrap">
                <Button
                    variant="primary"
                    size="sm"
                    href={`/alliances/${allianceId}/periods/${selectedPeriod.id}/record`}
                >
                    Record Results
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    href={`/alliances/${allianceId}/periods/${selectedPeriod.id}/import`}
                >
                    Import Evaluation Results
                </Button>
            </div>
        ) : null;

    const actionButtons = (
        <div className="flex items-center gap-3">
            {permissions.canImportMembers && (
                <Button
                    variant="secondary"
                    size="sm"
                    href={`/alliances/${allianceId}/members/import`}
                >
                    Import Members
                </Button>
            )}
            {permissions.canImportMembers && (
                <Button
                    variant="link"
                    size="sm"
                    href={`/alliances/${allianceId}/members/imports`}
                >
                    Import history
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
            title={`${alliance.name} Members`}
            description={description}
            action={allianceMembers.length > 0 ? actionButtons : undefined}
        >
            <div className="flex flex-col gap-4 mb-6">
                <MembersFilter
                    currentFilter={filter}
                    activeCount={activeCount}
                    archivedCount={archivedCount}
                    allianceId={allianceId}
                    periodId={selectedPeriodId}
                    className="mb-0"
                />
                <MembersPeriodSelector
                    allianceId={allianceId}
                    currentFilter={filter}
                    selectedPeriodId={selectedPeriodId}
                    periods={allPeriods}
                />
            </div>

            {contextualBanner.kind === "invalid-period" && (
                <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-text-primary">
                    <p>This evaluation period is not available.</p>
                    <Link
                        href={rosterHref}
                        className="mt-2 inline-block font-medium text-primary-light hover:text-primary hover:underline"
                    >
                        Return to roster
                    </Link>
                </div>
            )}

            {contextualBanner.kind === "no-periods" && (
                <div className="mb-6 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-text-primary">
                    <p>Create an evaluation period before viewing member results.</p>
                    {permissions.canConfigurePeriods ? (
                        <div className="mt-3">
                            <Button
                                variant="primary"
                                size="sm"
                                href={`/alliances/${allianceId}/periods`}
                            >
                                Go to Evaluation Periods
                            </Button>
                        </div>
                    ) : (
                        <p className="mt-2 text-text-secondary">
                            Ask an Admin or Owner to create an evaluation period.
                        </p>
                    )}
                </div>
            )}

            {contextualBanner.kind === "no-metrics" && selectedPeriod && (
                <div className="mb-6 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-text-primary">
                    <p>
                        <strong>{selectedPeriod.name}</strong> has no configured metrics yet.
                    </p>
                    {permissions.canConfigurePeriods ? (
                        <div className="mt-3">
                            <Button
                                variant="primary"
                                size="sm"
                                href={`/alliances/${allianceId}/periods/${selectedPeriod.id}`}
                            >
                                Manage Period Metrics
                            </Button>
                        </div>
                    ) : (
                        <div className="mt-3">
                            <Button
                                variant="secondary"
                                size="sm"
                                href={`/alliances/${allianceId}/periods/${selectedPeriod.id}`}
                            >
                                View Period
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {contextualBanner.kind === "no-results" && selectedPeriod && (
                <div className="mb-6 rounded-lg border border-border bg-surface-secondary p-4 text-sm text-text-primary">
                    <p>No results for members in this view.</p>
                    {periodResultsActions ?? (
                        <p className="mt-2 text-text-secondary">
                            {setupStatus.activeMemberCount === 0
                                ? "Record and import workflows operate on active members only."
                                : "You do not have permission to record or import evaluation results."}
                        </p>
                    )}
                </div>
            )}

            {showingActiveMemberPrerequisite || allianceMembers.length === 0 ? (
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
                            ? permissions.canImportMembers || permissions.canManageMembers
                                ? "Import members from a spreadsheet or add them manually to get started."
                                : "An alliance Admin or Owner must import or add members first."
                            : filter === "archived"
                            ? "Members that have been archived will appear here."
                            : undefined
                    }
                    action={
                        filter === "active"
                            ? permissions.canImportMembers || permissions.canManageMembers
                                ? (
                                    <div className="flex gap-3 flex-wrap justify-center">
                                        {permissions.canImportMembers && (
                                            <Button
                                                variant="primary"
                                                href={`/alliances/${allianceId}/members/import`}
                                            >
                                                Import Members
                                            </Button>
                                        )}
                                        {permissions.canManageMembers && (
                                            <Button
                                                variant={permissions.canImportMembers ? "secondary" : "primary"}
                                                href={`/alliances/${allianceId}/members/new`}
                                            >
                                                Add Member
                                            </Button>
                                        )}
                                    </div>
                                )
                                : (
                                    <Button
                                        variant="secondary"
                                        href={`/alliances/${allianceId}`}
                                    >
                                        Back to Dashboard
                                    </Button>
                                )
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
