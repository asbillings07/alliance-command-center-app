import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
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
    const user = await requireAuth();

    await requireLeadershipAccess(allianceId, user.id);

    const member = await prisma.allianceMember.findUnique({
        where: { id: memberId },
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

    if (!member || member.allianceId !== allianceId) {
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
