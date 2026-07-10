import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { RosterImportForm } from "./RosterImportForm";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
};

export default async function MemberImportPage({ params }: Params) {
    const { allianceId } = await params;
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.IMPORT_MEMBERS,
    });

    // Fetch existing alliance members to check for duplicates
    const existingMembersRaw = await prisma.allianceMember.findMany({
        where: { allianceId },
        select: {
            id: true,
            playerName: true,
            archivedAt: true,
        },
        orderBy: { playerName: "asc" },
    });

    // Serialize Date to ISO string for client component
    const existingMembers = existingMembersRaw.map((m) => ({
        id: m.id,
        playerName: m.playerName,
        archivedAt: m.archivedAt?.toISOString() ?? null,
    }));

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Import Roster</h1>
                    <p className="text-sm text-gray-600 mt-1">
                        Upload a CSV to add members to your alliance
                    </p>
                </div>
                <Link
                    href={`/alliances/${allianceId}/members`}
                    className="text-sm text-gray-600 hover:text-gray-900"
                >
                    ← Back to Members
                </Link>
            </div>

            <RosterImportForm
                allianceId={allianceId}
                existingMembers={existingMembers}
            />
        </div>
    );
}
