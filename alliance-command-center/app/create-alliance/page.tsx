import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { getPendingAllianceCreation } from "@/app/src/lib/betaInvitation";
import { prisma } from "@/app/src/lib/prisma";
import { CreateAllianceForm } from "./CreateAllianceForm";

export default async function CreateAlliancePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/create-alliance");
  }

  const existingMembership = await prisma.allianceMembership.findFirst({
    where: { userId: session.user.id },
  });

  if (existingMembership) {
    redirect(`/alliances/${existingMembership.allianceId}`);
  }

  const pendingCreation = await getPendingAllianceCreation(session.user.id);

  if (!pendingCreation) {
    redirect("/redeem");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
      <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#3B82F6]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#3B82F6]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Create Your Alliance
          </h1>
          <p className="text-[#9CA3AF]">
            Set up your alliance workspace to start managing your leadership
            team.
          </p>
        </div>

        <CreateAllianceForm betaInvitationId={pendingCreation.id} />
      </div>
    </div>
  );
}
