import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { notFound } from "next/navigation";
import { ImportForm } from "./ImportForm";
import Link from "next/link";

type Params = {
  params: Promise<{
    allianceId: string;
    periodId: string;
  }>;
};

export default async function ImportPage({ params }: Params) {
  const { allianceId, periodId } = await params;

  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
    include: {
      periodMetrics: {
        where: { active: true },
        include: { metric: true },
      },
    },
  });

  if (!period) {
    notFound();
  }

  const metrics = period.periodMetrics.map((pm) => ({
    id: pm.metric.id,
    name: pm.metric.name,
  }));

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: {
      allianceMembers: {
        where: { archivedAt: null },
        select: {
          id: true,
          playerName: true,
        },
        orderBy: { playerName: "asc" },
      },
    },
  });

  // Back link depends on whether user can access the period detail page
  const backLink = auth.permissions.canConfigurePeriods
    ? { href: `/alliances/${allianceId}/periods/${periodId}`, label: "← Back to Period" }
    : { href: `/alliances/${allianceId}`, label: "← Back to Dashboard" };

  const hasNoMembers = !alliance || alliance.allianceMembers.length === 0;
  const hasNoMetrics = metrics.length === 0;

  if (hasNoMetrics || hasNoMembers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{period.name}</h1>
          <h2 className="text-lg text-gray-600">Import from Spreadsheet</h2>
        </div>

        <div className="w-full max-w-md bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          {hasNoMetrics ? (
            <>
              <p className="text-gray-900 font-medium mb-2">
                No metrics configured
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Add metrics to this evaluation period before importing data.
              </p>
              {auth.permissions.canConfigurePeriods && (
                <Link
                  href={`/alliances/${allianceId}/periods/${periodId}`}
                  className="inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                >
                  Configure Metrics
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-900 font-medium mb-2">
                No active members
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Import your alliance roster before importing metrics.
              </p>
              {auth.permissions.canImportMembers && (
                <Link
                  href={`/alliances/${allianceId}/members/import`}
                  className="inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                >
                  Import Members
                </Link>
              )}
            </>
          )}
        </div>

        <Link
          href={backLink.href}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {backLink.label}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
      <h1 className="text-2xl font-bold">{period.name}</h1>
      <h2 className="text-lg text-gray-600">Import from Spreadsheet</h2>
      <p className="text-sm text-gray-500 max-w-md text-center">
        Upload any CSV with player data. You choose which columns to import.
      </p>

      <div className="flex gap-4 text-sm">
        <Link href={backLink.href} className="text-gray-500 hover:text-gray-700">
          {backLink.label}
        </Link>
        <Link
          href={`/alliances/${allianceId}/periods/${periodId}/record`}
          className="text-blue-500 hover:text-blue-700"
        >
          Manual Entry →
        </Link>
      </div>

      <hr className="w-full max-w-2xl border-gray-200" />

      <ImportForm
        periodId={periodId}
        allianceId={allianceId}
        members={alliance.allianceMembers}
        metrics={metrics}
      />
    </div>
  );
}
