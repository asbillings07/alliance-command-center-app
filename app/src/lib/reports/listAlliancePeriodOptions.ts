import "server-only";
import { prisma } from "@/app/src/lib/prisma";
import { metricPeriodChronologicalOrderBy } from "@/app/src/lib/metricPeriodOrdering";

export type AlliancePeriodOption = {
  id: string;
  name: string;
  active: boolean;
};

/**
 * Every evaluation period for the alliance, for the performance report's
 * period selector (#264). Deliberately alliance-wide, not filtered by any
 * single metric's attachment history like `listReportPeriodOptions` (#190)
 * — the alliance overview shows every configured metric at once, some of
 * which may not be attached to a given period at all, and that absence is
 * itself part of what the report reveals rather than a reason to hide the
 * period from the selector.
 */
export async function listAlliancePeriodOptions(allianceId: string): Promise<AlliancePeriodOption[]> {
  const periods = await prisma.metricPeriod.findMany({
    where: { allianceId },
    select: { id: true, name: true, active: true },
    orderBy: metricPeriodChronologicalOrderBy,
  });

  return periods;
}
