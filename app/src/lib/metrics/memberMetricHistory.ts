import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import type { Prisma } from "@/app/generated/prisma/client";

export const HISTORY_PAGE_SIZE = 25;
const orderBy = [{ recordedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] as const;
const select = {
  id: true, value: true, status: true, recordedAt: true, createdAt: true,
  observedOn: true, enteredByName: true, enteredByRole: true, entryMethod: true,
  metric: { select: { id: true, name: true, unitLabel: true } },
  periodMetric: { select: { period: { select: { name: true } } } },
} satisfies Prisma.MemberMetricEntrySelect;
export type MetricHistoryEntry = Prisma.MemberMetricEntryGetPayload<{ select: typeof select }>;

/** A bounded entry ledger, not an as-known-then report replay. Ordering matches
 * ADR-018 for corrections, but timestamps/id do not claim commit chronology.
 * All selectors, including pagination and deep links, are tenant/member scoped.
 */
export async function loadMemberMetricHistory(input: {
  allianceId: string; memberId: string; metricId?: string; before?: string; entryId?: string;
}) {
  const { allianceId, memberId, metricId, before, entryId } = input;
  await requireAllianceAccess({ allianceId, requiredPermission: Permissions.VIEW_MEMBERS });
  const member = await prisma.allianceMember.findFirst({
    where: { id: memberId, allianceId }, select: { playerName: true, archivedAt: true },
  });
  if (!member) notFound();
  const where: Prisma.MemberMetricEntryWhereInput = {
    allianceMemberId: memberId, allianceMember: { allianceId },
    metric: { allianceId }, periodMetric: { period: { allianceId } },
    ...(metricId ? { metricId } : {}),
  };
  const metrics = await prisma.metric.findMany({
    where: { allianceId, entries: { some: { allianceMemberId: memberId } } },
    select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  if (metricId && !metrics.some((metric) => metric.id === metricId)) notFound();
  const [anchor, chosen] = await Promise.all([
    before ? prisma.memberMetricEntry.findFirst({ where: { ...where, id: before }, select }) : null,
    entryId ? prisma.memberMetricEntry.findFirst({ where: { ...where, id: entryId }, select }) : null,
  ]);
  if ((before && !anchor) || (entryId && !chosen)) notFound();
  const rows = await prisma.memberMetricEntry.findMany({
    where: {
      ...where,
      // Keyset bounds prevent new inserts from shifting older pages. A cursor
      // from another member/alliance/metric cannot be used to probe history.
      ...(anchor ? { OR: [
        { recordedAt: { lt: anchor.recordedAt } },
        { recordedAt: anchor.recordedAt, createdAt: { lt: anchor.createdAt } },
        { recordedAt: anchor.recordedAt, createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ] } : {}),
    },
    select, orderBy: [...orderBy], take: HISTORY_PAGE_SIZE + 1,
  });
  const entries = rows.slice(0, HISTORY_PAGE_SIZE);
  return {
    member, metrics, entries, selected: chosen ?? entries[0] ?? null,
    nextBefore: rows.length > HISTORY_PAGE_SIZE ? entries.at(-1)!.id : null,
  };
}
