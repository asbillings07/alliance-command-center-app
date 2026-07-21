import { Suspense } from "react";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { RosterImportForm } from "./RosterImportForm";
import { PageLayout, Card } from "@/app/src/components";
import { TourAutoStart } from "@/app/src/components/client";

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

    const existingMembersRaw = await prisma.allianceMember.findMany({
        where: { allianceId },
        select: {
            id: true,
            playerName: true,
            archivedAt: true,
        },
        orderBy: { playerName: "asc" },
    });

    const existingMembers = existingMembersRaw.map((m) => ({
        id: m.id,
        playerName: m.playerName,
        archivedAt: m.archivedAt?.toISOString() ?? null,
    }));

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Members", href: `/alliances/${allianceId}/members` },
                { label: "Import" },
            ]}
            title="Import Roster"
            description="Upload a CSV to add members to your alliance"
        >
            <Suspense fallback={null}>
                <TourAutoStart />
            </Suspense>
            <Card>
                <Card.Body>
                    <RosterImportForm
                        allianceId={allianceId}
                        existingMembers={existingMembers}
                    />
                </Card.Body>
            </Card>
        </PageLayout>
    );
}
