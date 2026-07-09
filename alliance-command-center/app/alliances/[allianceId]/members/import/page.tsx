import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { RosterImportForm } from "./RosterImportForm";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
};

export default async function MemberImportPage({ params }: Params) {
    const { allianceId } = await params;
    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

    // Fetch existing members to check for duplicates
    const existingMembers = await prisma.member.findMany({
        where: { allianceId },
        select: {
            id: true,
            playerName: true,
        },
        orderBy: { playerName: "asc" },
    });

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
