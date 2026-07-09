import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { formatPower } from "@/app/src/lib/formatPower";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireMembershipAccess } from "@/app/src/lib/auth/requireMembershipAccess";
import { LeadershipNoteCard } from "./LeadershipNoteCard";
import { MemberPerformanceSection } from "./MemberPerformanceSection";
import type { CurrentMetricViewModel } from "./MemberPerformanceSection";

type Params = {
    params: Promise<{
        allianceId: string;
        memberId: string;
    }>
}

export default async function MemberPage({ params }: Params) {
    const { allianceId, memberId } = await params;
    const user = await requireAuth();
    const { member } = await requireMembershipAccess(memberId, user.id);

    if (member.allianceId !== allianceId) {
        notFound();
    }

    // Query 1: Active period with configured metrics
    // orderBy ensures deterministic selection if multiple active periods exist
    const activePeriod = await prisma.metricPeriod.findFirst({
        where: {
            allianceId,
            active: true,
        },
        orderBy: {
            createdAt: "desc",
        },
        include: {
            periodMetrics: {
                where: { active: true },
                include: {
                    metric: true,
                },
            },
        },
    });

    // Query 2: Member's metric entries for the active period (if exists)
    // Filter to only active metric IDs to reduce unnecessary data transfer
    const activeMetricIds = activePeriod?.periodMetrics.map((pm) => pm.metricId) ?? [];
    const memberEntries = activePeriod
        ? await prisma.memberMetricEntry.findMany({
              where: {
                  memberId: member.id,
                  periodId: activePeriod.id,
                  metricId: { in: activeMetricIds },
              },
              orderBy: [
                  { metricId: "asc" },
                  { recordedAt: "desc" },
              ],
          })
        : [];

    // Build view model: group entries by metricId (cap at 2 per metric)
    const entriesByMetric = new Map<string, typeof memberEntries>();
    for (const entry of memberEntries) {
        const list = entriesByMetric.get(entry.metricId) || [];
        if (list.length < 2) {
            list.push(entry);
            entriesByMetric.set(entry.metricId, list);
        }
    }

    // Build the performance view model
    const performanceMetrics: CurrentMetricViewModel[] = activePeriod
        ? activePeriod.periodMetrics.map((pm) => {
              const entries = entriesByMetric.get(pm.metricId) || [];
              const current = entries[0];
              const previous = entries[1];

              return {
                  metricId: pm.metricId,
                  metricName: pm.metric.name,
                  current: current
                      ? { value: current.value, recordedAt: current.recordedAt }
                      : undefined,
                  previous: previous
                      ? { value: previous.value, recordedAt: previous.recordedAt }
                      : undefined,
                  delta:
                      current && previous
                          ? current.value - previous.value
                          : undefined,
              };
          })
        : [];

    // Determine empty state
    const performanceEmptyState: "no-period" | "no-metrics" | "has-metrics" =
        !activePeriod
            ? "no-period"
            : activePeriod.periodMetrics.length === 0
            ? "no-metrics"
            : "has-metrics";

    // Query 3: Leadership notes
    const leadershipNotes = await prisma.leadershipNote.findMany({
        where: {
            memberId: memberId,
        },
        include: {
            author: {
                select: {
                    id: true,
                    displayName: true,
                },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
    });


    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
            <section className="flex flex-col items-center justify-center">
                <h1 className="text-2xl font-bold">{member.playerName}</h1>
                <div className="text-sm text-gray-500 mt-2">
                    THP: {member.thp == null ? "—" : formatPower(member.thp)}
                </div>
                <div className="text-sm text-gray-500">
                    Top Squad: {member.squadPower == null ? "—" : formatPower(member.squadPower)}
                </div>
            </section>

            <MemberPerformanceSection
                periodName={activePeriod?.name ?? null}
                metrics={performanceMetrics}
                emptyState={performanceEmptyState}
            />

            <section className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-center text-gray-900">Leadership Notes</h2>
                <LeadershipNoteCard memberId={member.id} mode="create" />
                {leadershipNotes.length > 0 ? (
                    leadershipNotes.map((note) => (
                        <LeadershipNoteCard
                            key={note.id}
                            memberId={member.id}
                            mode="view"
                            note={{
                                id: note.id,
                                content: note.content,
                                noteKey: `${note.id}-${note.updatedAt.getTime()}`,
                                noteType: note.noteType,
                                authorName: note.author.displayName,
                                createdAt: note.createdAt.toLocaleDateString(),
                                isAuthor: note.author.id === user.id,
                            }}
                        />
                    ))
                ) : (
                    <div className="text-sm text-gray-500 text-center py-4">
                        No leadership notes yet.
                    </div>
                )}
            </section>
        </div>
    );
}
