import "server-only";
import { prisma } from "@/app/src/lib/prisma";
import { pickCurrentMetricPeriod } from "@/app/src/lib/metricPeriodOrdering";

export type DefaultReportPeriodCandidate = {
  id: string;
  name: string;
  startsAt: Date | null;
  createdAt: Date;
  periodActive: boolean;
  attachmentActive: boolean;
};

export type DefaultReportPeriod = { id: string; name: string };

/**
 * Pure selection logic (#190): a specific metric — not the alliance's generic
 * "current period" — decides its own report default, because a period can be
 * "current" for the alliance without this metric ever having been attached to
 * it. Prefers the latest ACTIVE period where this metric has an ACTIVE
 * attachment; if none exists, falls back to the latest period where it was
 * EVER attached (any period/attachment active value), so a report for a
 * since-archived metric or period still opens somewhere meaningful. Returns
 * null only when the metric has never been attached to any period.
 */
export function pickDefaultReportPeriod(
  candidates: readonly DefaultReportPeriodCandidate[],
): DefaultReportPeriod | null {
  const activeBoth = candidates.filter(
    (candidate) => candidate.periodActive && candidate.attachmentActive,
  );
  const pool = activeBoth.length > 0 ? activeBoth : candidates;
  const picked = pickCurrentMetricPeriod(pool);
  return picked ? { id: picked.id, name: picked.name } : null;
}

export async function resolveDefaultReportPeriod(
  allianceId: string,
  metricId: string,
): Promise<DefaultReportPeriod | null> {
  const attachments = await prisma.metricPeriodMetric.findMany({
    where: { metricId, period: { allianceId } },
    select: {
      active: true,
      period: {
        select: { id: true, name: true, startsAt: true, createdAt: true, active: true },
      },
    },
  });

  const candidates: DefaultReportPeriodCandidate[] = attachments.map((attachment) => ({
    id: attachment.period.id,
    name: attachment.period.name,
    startsAt: attachment.period.startsAt,
    createdAt: attachment.period.createdAt,
    periodActive: attachment.period.active,
    attachmentActive: attachment.active,
  }));

  return pickDefaultReportPeriod(candidates);
}
