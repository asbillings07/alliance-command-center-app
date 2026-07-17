import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { getPendingAllianceCreation } from "@/app/src/lib/betaInvitation";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { AllianceRole } from "@/app/generated/prisma/enums";

export default async function AppPage() {
    const session = await auth();

    if (!session || !session.user?.id) {
        redirect("/login");
    }

    const memberships = await prisma.allianceMembership.findMany({
        where: {
            userId: session.user.id,
        },
        select: {
            allianceId: true,
            role: true,
        },
        take: 2,
    });

    if (memberships.length === 0) {
        const pendingCreation = await getPendingAllianceCreation(session.user.id);
        if (pendingCreation) {
            redirect("/create-alliance");
        }
        redirect("/redeem");
    }

    if (memberships.length === 1) {
        const { allianceId, role } = memberships[0];

        // Only redirect owners to setup if incomplete
        // Collaborators go directly to dashboard - they can't complete owner tasks
        if (role === AllianceRole.OWNER) {
            const status = await getAllianceSetupStatus(allianceId);
            if (!status.isComplete) {
                redirect(`/alliances/${allianceId}/setup`);
            }
        }

        redirect(`/alliances/${allianceId}`);
    }

    if (memberships.length > 1) {
        redirect("/alliances/select_alliance");
    }
}