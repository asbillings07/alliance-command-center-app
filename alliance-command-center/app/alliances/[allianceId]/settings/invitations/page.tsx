import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { InviteCollaboratorForm } from "./InviteCollaboratorForm";
import { PendingInvitations } from "./PendingInvitations";

type PageProps = {
  params: Promise<{ allianceId: string }>;
};

export default async function InvitationsPage({ params }: PageProps) {
  const { allianceId } = await params;
  
  // Require INVITE_COLLABORATORS to view this page (including invitation data)
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
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link
          href={`/alliances/${allianceId}`}
          className="text-[#9CA3AF] hover:text-[#D1D5DB] text-sm inline-flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
          {alliance.name}
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#F9FAFB]">
          Leadership Team
        </h1>
        <p className="text-[#9CA3AF] mt-1">
          Invite collaborators to help manage your alliance.
        </p>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#9CA3AF] uppercase tracking-wide mb-3">
          Invite Collaborator
        </h2>
        <div className="bg-[#111827] border border-[#374151] rounded-lg p-6">
          <InviteCollaboratorForm allianceId={allianceId} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-[#9CA3AF] uppercase tracking-wide mb-3">
          Pending Invitations
        </h2>
        <div className="bg-[#111827] border border-[#374151] rounded-lg p-6">
          <PendingInvitations
            invitations={serializedInvitations}
            allianceId={allianceId}
          />
        </div>
      </section>
    </div>
  );
}
