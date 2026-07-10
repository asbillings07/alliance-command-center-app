import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { EditMemberForm } from "./EditMemberForm";
import { PageLayout, Card } from "@/app/src/components";

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
    <PageLayout
      breadcrumb={[
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Members", href: `/alliances/${allianceId}/members` },
        { label: member.playerName, href: `/alliances/${allianceId}/members/${memberId}` },
        { label: "Edit" },
      ]}
      title={`Edit ${member.playerName}`}
      maxWidth="lg"
    >
      <Card>
        <Card.Body>
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
        </Card.Body>
      </Card>
    </PageLayout>
  );
}
