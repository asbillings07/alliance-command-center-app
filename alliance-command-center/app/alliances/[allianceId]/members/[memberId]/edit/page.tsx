import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { EditMemberForm } from "./EditMemberForm";

type Params = {
    params: Promise<{
        allianceId: string;
        memberId: string;
    }>;
};

export default async function EditMemberPage({ params }: Params) {
    const { allianceId, memberId } = await params;

    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.MANAGE_MEMBERS,
    });

    const member = await prisma.allianceMember.findFirst({
        where: { id: memberId, allianceId },
        select: {
            id: true,
            playerName: true,
            thp: true,
            squadPower: true,
            role: true,
            allianceId: true,
            archivedAt: true,
            alliance: {
                select: { name: true },
            },
        },
    });

    if (!member) {
        notFound();
    }

    if (member.archivedAt) {
        notFound();
    }

    return (
        <div className="mx-auto max-w-lg p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">
                Edit {member.playerName}
            </h1>
            <EditMemberForm
                allianceId={allianceId}
                memberId={memberId}
                defaultValues={{
                    playerName: member.playerName,
                    thp: member.thp,
                    squadPower: member.squadPower,
                    role: member.role,
                }}
            />
        </div>
    );
}
