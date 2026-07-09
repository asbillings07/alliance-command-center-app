import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import Link from "next/link";
import { formatPower } from "@/app/src/lib/formatPower";
import { MembersFilter } from "./MembersFilter";

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

    const session = await auth();
    if (!session || !session.user?.id) {
        redirect("/login");
    }

    const membership = await prisma.allianceMembership.findUnique({
        where: {
            allianceId_userId: {
                allianceId: allianceId,
                userId: session.user.id,
            },
        },
    });

    if (!membership) {
        redirect("/app");
    }

    const alliance = await prisma.alliance.findUnique({
        where: {
            id: allianceId,
        },
    });

    if (!alliance) {
        redirect("/app");
    }

    // Build where clause based on filter
    const whereClause = {
        allianceId: allianceId,
        ...(filter === "active" && { archivedAt: null }),
        ...(filter === "archived" && { archivedAt: { not: null } }),
        // "all" has no additional filter
    };

    const allianceMembers = await prisma.allianceMember.findMany({
        where: whereClause,
        orderBy: {
            playerName: "asc",
        },
    });

    // Get counts for filter badges
    const [activeCount, archivedCount] = await Promise.all([
        prisma.allianceMember.count({
            where: { allianceId, archivedAt: null },
        }),
        prisma.allianceMember.count({
            where: { allianceId, archivedAt: { not: null } },
        }),
    ]);

    const isLeadership = membership.role !== "VIEWER";

    return (
        <div className="mx-auto max-w-4xl p-8">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {alliance.name} Roster
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {allianceMembers.length} member{allianceMembers.length !== 1 ? "s" : ""}
                        {filter !== "all" && ` (${filter})`}
                    </p>
                </div>
                {isLeadership && (
                    <div className="flex gap-3">
                        <Link
                            href={`/alliances/${allianceId}/members/import`}
                            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
                        >
                            Import Roster
                        </Link>
                        <Link
                            href={`/alliances/${allianceId}/members/new`}
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                        >
                            Add Member
                        </Link>
                    </div>
                )}
            </div>

            <MembersFilter
                currentFilter={filter}
                activeCount={activeCount}
                archivedCount={archivedCount}
                allianceId={allianceId}
            />

            {allianceMembers.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-gray-600">
                        {filter === "active"
                            ? "No active members yet."
                            : filter === "archived"
                            ? "No archived members."
                            : "No members yet."}
                    </p>
                    {filter === "active" && isLeadership && (
                        <p className="text-sm text-gray-500 mt-2">
                            Import your roster or add members manually to get started.
                        </p>
                    )}
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                                    Player
                                </th>
                                <th className="text-right px-4 py-3 text-sm font-medium text-gray-700">
                                    THP
                                </th>
                                <th className="text-right px-4 py-3 text-sm font-medium text-gray-700">
                                    Squad Power
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                                    Role
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {allianceMembers.map((member) => (
                                <tr
                                    key={member.id}
                                    className="border-b border-gray-100 hover:bg-gray-50"
                                >
                                    <td className="px-4 py-3">
                                        <Link
                                            href={`/alliances/${allianceId}/members/${member.id}`}
                                            className="font-medium text-blue-600 hover:text-blue-800"
                                        >
                                            {member.playerName}
                                        </Link>
                                        {member.archivedAt && (
                                            <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                                Archived
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-600">
                                        {member.thp == null ? "—" : formatPower(member.thp)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-600">
                                        {member.squadPower == null ? "—" : formatPower(member.squadPower)}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        {member.role || "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
