import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { prisma } from "@/app/src/lib/prisma";
import { ConfirmMemberForm } from "./ConfirmMemberForm";

type PageProps = {
  params: Promise<{ allianceId: string }>;
};

export default async function ConfirmMemberPage({ params }: PageProps) {
  const { allianceId } = await params;
  const user = await requireAuth();

  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    redirect("/alliances/select_alliance");
  }

  const existingLink = await prisma.allianceMember.findFirst({
    where: {
      allianceId,
      userId: user.id,
    },
  });

  if (existingLink) {
    redirect(`/alliances/${allianceId}`);
  }

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: { id: true, name: true },
  });

  if (!alliance) {
    notFound();
  }

  const unlinkedMembers = await prisma.allianceMember.findMany({
    where: {
      allianceId,
      userId: null,
      archivedAt: null,
    },
    select: {
      id: true,
      playerName: true,
    },
    orderBy: { playerName: "asc" },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Welcome to {alliance.name}!
          </h1>
          <p className="text-gray-600">
            Which roster member are you?
          </p>
        </div>

        <ConfirmMemberForm
          allianceId={allianceId}
          members={unlinkedMembers}
        />
      </div>
    </div>
  );
}
