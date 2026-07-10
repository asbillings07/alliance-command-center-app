import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import Link from "next/link";
import { formatPower } from "@/app/src/lib/formatPower";
import { MembersFilter } from "./MembersFilter";
import { PageLayout, Card, Button, Badge, EmptyState } from "@/app/src/components";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
    searchParams: Promise<{
        filter?: string;
    }>;
};

type FilterType = "active" | "archived" | "all";

function isValidFilter(filter: string | undefined): filter is FilterType {
    return filter === "active" || filter === "archived" || filter === "all";
}

export default async function MembersPage({ params, searchParams }: Params) {
    const { allianceId } = await params;
    const { filter: filterParam } = await searchParams;
    
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

    const [activeCount, archivedCount] = await Promise.all([
        prisma.allianceMember.count({
            where: { allianceId, archivedAt: null },
        }),
        prisma.allianceMember.count({
            where: { allianceId, archivedAt: { not: null } },
        }),
    ]);

    const { permissions } = authContext;

    const description = `${allianceMembers.length} member${allianceMembers.length !== 1 ? "s" : ""}${filter !== "all" ? ` (${filter})` : ""}`;

    const actionButtons = (
        <div className="flex gap-3">
            {permissions.canImportMembers && (
                <Button
                    variant="secondary"
                    size="sm"
                    href={`/alliances/${allianceId}/members/import`}
                >
                    Import Roster
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
                        filter === "active" && permissions.canManageMembers
                            ? "Import your roster or add members manually to get started."
                            : undefined
                    }
                    action={
                        filter === "active" && permissions.canManageMembers
                            ? { label: "Add Member", href: `/alliances/${allianceId}/members/new` }
                            : undefined
                    }
                />
            ) : (
                <Card>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-surface-secondary border-b border-primary">
                                <tr>
                                    <th className="text-left px-4 py-3 text-sm font-medium text-secondary">
                                        Player
                                    </th>
                                    <th className="text-right px-4 py-3 text-sm font-medium text-secondary">
                                        THP
                                    </th>
                                    <th className="text-right px-4 py-3 text-sm font-medium text-secondary">
                                        Squad Power
                                    </th>
                                    <th className="text-left px-4 py-3 text-sm font-medium text-secondary">
                                        Role
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {allianceMembers.map((member) => (
                                    <tr
                                        key={member.id}
                                        className="border-b border-secondary hover:bg-surface-secondary transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/alliances/${allianceId}/members/${member.id}`}
                                                className="font-medium text-accent-primary hover:text-accent-hover"
                                            >
                                                {member.playerName}
                                            </Link>
                                            {member.archivedAt && (
                                                <Badge variant="neutral" size="sm" className="ml-2">
                                                    Archived
                                                </Badge>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right text-secondary">
                                            {member.thp == null ? "—" : formatPower(member.thp)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-secondary">
                                            {member.squadPower == null ? "—" : formatPower(member.squadPower)}
                                        </td>
                                        <td className="px-4 py-3 text-secondary">
                                            {member.role || "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </PageLayout>
    );
}
