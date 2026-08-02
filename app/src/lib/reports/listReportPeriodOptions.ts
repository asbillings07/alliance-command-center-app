import "server-only";
import { prisma } from "@/app/src/lib/prisma";
import { metricPeriodChronologicalOrderBy } from "@/app/src/lib/metricPeriodOrdering";

export type ReportPeriodOption = {
  id: string;
  name: string;
  /** Whether the period itself is active (not archived). */
  periodActive: boolean;
  /** Whether this metric's `MetricPeriodMetric` attachment is active for this period. */
  attachmentActive: boolean;
};

/**
 * Periods this metric has ever been attached to (#190), for the report
 * page's period selector. Deliberately narrower than "every alliance
 * period" — a period the metric was never attached to can only ever render
 * a `NOT_ATTACHED` report, so listing it would just add noise to the
 * dropdown without a leader ever wanting to select it.
 *
 * Ordered newest-first via the same chronological convention used to pick
 * the alliance's "current" period, so the freshest period the metric has
 * data for sorts to the top.
 */
export async function listReportPeriodOptions(
  allianceId: string,
  metricId: string,
): Promise<ReportPeriodOption[]> {
  const periods = await prisma.metricPeriod.findMany({
    where: { allianceId, periodMetrics: { some: { metricId } } },
    select: {
      id: true,
      name: true,
      active: true,
      startsAt: true,
      createdAt: true,
      periodMetrics: { where: { metricId }, select: { active: true } },
    },
    orderBy: metricPeriodChronologicalOrderBy,
  });

  return periods.map((period) => ({
    id: period.id,
    name: period.name,
    periodActive: period.active,
    // `some: { metricId }` guarantees exactly one matching MetricPeriodMetric row.
    attachmentActive: period.periodMetrics[0]?.active ?? false,
  }));
}
