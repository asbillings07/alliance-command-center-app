import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { AddMemberForm } from "./AddMemberForm";
import Link from "next/link";

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
    <div className="mx-auto max-w-lg p-8">
      <Link
        href={`/alliances/${allianceId}/members`}
        className="text-sm text-gray-600 hover:text-gray-900"
      >
        ← Back to Roster
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-4 mb-6">
        Add Member to {alliance.name}
      </h1>
      <AddMemberForm allianceId={allianceId} />
    </div>
  );
}
