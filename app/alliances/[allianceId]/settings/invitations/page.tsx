import { notFound } from "next/navigation";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { InvitationWorkspace } from "./InvitationWorkspace";
import { PageLayout } from "@/app/src/components";

type PageProps = {
  params: Promise<{ allianceId: string }>;
};

export default async function InvitationsPage({ params }: PageProps) {
  const { allianceId } = await params;
  
  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.INVITE_COLLABORATORS,
  });

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: { id: true, name: true },
  });

  if (!alliance) {
    notFound();
  }

  const pendingInvitations = await prisma.invitation.findMany({
    where: {
      allianceId,
      acceptedAt: null,
      cancelledAt: null,
    },
    include: {
      invitedBy: {
        select: { displayName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const serializedInvitations = pendingInvitations.map((inv) => ({
    id: inv.id,
    playerNameSnapshot: inv.playerNameSnapshot,
    email: inv.email,
    membershipRole: inv.membershipRole,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    invitedBy: inv.invitedBy,
  }));

  return (
    <PageLayout
      breadcrumb={[
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Leadership Team" },
      ]}
      title="Leadership Team"
      description="Invite collaborators to help manage your alliance."
    >
      <InvitationWorkspace allianceId={allianceId} invitations={serializedInvitations} />
    </PageLayout>
  );
}
