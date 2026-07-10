import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import Link from "next/link";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

export default async function AlliancePage({ params }: Params) {
  const { allianceId } = await params;
  if (!allianceId) {
    redirect("/app");
  }

  const auth = await requireAllianceAccess({ allianceId });
  const { permissions } = auth;

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
  });

  if (!alliance) {
    redirect("/app");
  }

  // For users with canImportMetrics but not canConfigurePeriods (Leaders),
  // find an active period so they can record metrics directly
  let activePeriod: { id: string; name: string } | null = null;
  if (permissions.canImportMetrics && !permissions.canConfigurePeriods) {
    const period = await prisma.metricPeriod.findFirst({
      where: { allianceId, active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    });
    activePeriod = period;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold">Alliance: {alliance.name}</h1>
      <p className="text-lg">Server: {alliance.server}</p>
      <p className="text-lg">Role: {auth.membership.role}</p>

      <div className="flex flex-col items-center justify-center gap-4 mt-6">
        <h2 className="text-lg font-semibold">Modules:</h2>

        <Link
          href={`/alliances/${allianceId}/members`}
          className="bg-blue-500 text-white rounded-md p-2 cursor-pointer min-w-48 text-center"
        >
          Members
        </Link>

        {permissions.canConfigureMetrics && (
          <Link
            href={`/alliances/${allianceId}/metrics`}
            className="bg-blue-500 text-white rounded-md p-2 cursor-pointer min-w-48 text-center"
          >
            Metrics Library
          </Link>
        )}

        {permissions.canConfigurePeriods && (
          <Link
            href={`/alliances/${allianceId}/periods`}
            className="bg-blue-500 text-white rounded-md p-2 cursor-pointer min-w-48 text-center"
          >
            Evaluation Periods
          </Link>
        )}

        {/* Leaders can import metrics but can't configure periods - give them direct access */}
        {permissions.canImportMetrics && !permissions.canConfigurePeriods && (
          activePeriod ? (
            <Link
              href={`/alliances/${allianceId}/periods/${activePeriod.id}/record`}
              className="bg-blue-500 text-white rounded-md p-2 cursor-pointer min-w-48 text-center"
            >
              Record Metrics
            </Link>
          ) : (
            <span className="text-gray-500 p-2 min-w-48 text-center">
              No active evaluation period
            </span>
          )
        )}

        {permissions.canInviteCollaborators && (
          <Link
            href={`/alliances/${allianceId}/settings/invitations`}
            className="bg-blue-500 text-white rounded-md p-2 cursor-pointer min-w-48 text-center"
          >
            Leadership Team
          </Link>
        )}
      </div>
    </div>
  );
}