import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { validateSetupImportReturnTo } from "@/app/src/lib/setup/validateSetupImportReturnTo";
import { ImportModeSwitcher } from "./ImportModeSwitcher";
import { PageLayout, Card, BackToSetupLink } from "@/app/src/components";
import { TourAutoStart } from "@/app/src/components/client";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
    searchParams: Promise<{
        returnTo?: string;
    }>;
};

export default async function MemberImportPage({ params, searchParams }: Params) {
    const { allianceId } = await params;
    const { returnTo: rawReturnTo } = await searchParams;
    const auth = await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.IMPORT_MEMBERS,
    });

    const returnTo = validateSetupImportReturnTo(rawReturnTo, allianceId);

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
                { label: "Import Members" },
            ]}
            title="Member Import"
            description="Upload a spreadsheet (.xlsx, .xls, .csv) to create or restore members in your alliance. Existing active members are identified and skipped."
            action={<BackToSetupLink allianceId={allianceId} />}
        >
            <TourAutoStart />
            <Card>
                <Card.Body>
                    <ImportModeSwitcher
                        allianceId={allianceId}
                        existingMembers={existingMembers}
                        returnTo={returnTo ?? undefined}
                        canManageMembers={auth.permissions.canManageMembers}
                    />
                </Card.Body>
            </Card>
        </PageLayout>
    );
}
