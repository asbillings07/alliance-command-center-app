import { productionPilotConfigured } from "@/app/src/lib/ocr/productionPilot";
import Link from "next/link";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { isolatedOcrDatabaseAvailable } from "@/app/src/lib/ocr/isolatedDatabase";
import { LocalTimestamp } from "./LocalTimestamp";

export async function SavedScoreBatches({ allianceId, periodId }: { allianceId: string; periodId: string }) {
  await requireAllianceAccess({ allianceId, requiredPermission: Permissions.IMPORT_METRICS });
  if (!isolatedOcrDatabaseAvailable() && !productionPilotConfigured()) return null;
  const batches = await prisma.ocrScoreBatch.findMany({ where: { allianceId, periodId }, orderBy: [{ savedAt: "desc" }, { id: "desc" }], take: 10,
    select: { id: true, savedAt: true, excludedRows: true, entries: { where: { periodId, allianceMember: { allianceId } },
      orderBy: { allianceMember: { playerName: "asc" } }, select: { id: true, ocrCreatedRosterMember: true, allianceMemberId: true, allianceMember: { select: { playerName: true } },
        value: true, observedOn: true, metric: { select: { name: true } } } } } });
  if (!batches.length) return null;
  return <section className="mt-6 space-y-2"><h2 className="text-lg font-semibold">Saved score batches</h2>
    {batches.map(b => <details key={b.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer">
      {b.entries.length} scores saved · <LocalTimestamp value={b.savedAt.toISOString()} /> · {b.excludedRows} excluded</summary>
      <ul className="mt-3 space-y-2">{b.entries.map(e => <li key={e.id}>
        <Link className="text-primary underline" href={`/alliances/${allianceId}/members/${e.allianceMemberId}/history?entryId=${e.id}`}>{e.allianceMember.playerName}</Link>{e.ocrCreatedRosterMember && " · Created in this batch"}
        {" · "}{e.metric.name} · {e.observedOn?.toISOString().slice(0,10) ?? "Weekly total"} · {e.value?.toLocaleString("en-US")}
      </li>)}</ul>
    </details>)}
  </section>;
}
