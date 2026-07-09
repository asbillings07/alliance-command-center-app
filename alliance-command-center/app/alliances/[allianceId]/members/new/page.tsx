import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { AddMemberForm } from "./AddMemberForm";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
};

export default async function NewMemberPage({ params }: Params) {
    const { allianceId } = await params;
    const user = await requireAuth();

    await requireLeadershipAccess(allianceId, user.id);

    const alliance = await prisma.alliance.findUnique({
        where: { id: allianceId },
        select: { id: true, name: true },
    });

    if (!alliance) {
        notFound();
    }

    return (
        <div className="mx-auto max-w-lg p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">
                Add Member to {alliance.name}
            </h1>
            <AddMemberForm allianceId={allianceId} />
        </div>
    );
}
