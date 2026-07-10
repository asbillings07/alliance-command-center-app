import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { AddMemberForm } from "./AddMemberForm";
import { PageLayout, Card } from "@/app/src/components";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

export default async function NewMemberPage({ params }: Params) {
  const { allianceId } = await params;

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.MANAGE_MEMBERS,
  });

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: { id: true, name: true },
  });

  if (!alliance) {
    notFound();
  }

  return (
    <PageLayout
      breadcrumb={[
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Members", href: `/alliances/${allianceId}/members` },
        { label: "Add Member" },
      ]}
      title={`Add Member to ${alliance.name}`}
      maxWidth="lg"
    >
      <Card>
        <Card.Body>
          <AddMemberForm allianceId={allianceId} />
        </Card.Body>
      </Card>
    </PageLayout>
  );
}
