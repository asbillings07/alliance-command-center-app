import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { formatPower } from "@/app/src/lib/formatPower";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { LeadershipNoteCard } from "./LeadershipNoteCard";
import { MemberPerformanceSection } from "./MemberPerformanceSection";
import type { CurrentMetricViewModel } from "./MemberPerformanceSection";
import { MemberActions } from "./MemberActions";
import { MemberAccountSection } from "./MemberAccountSection";

type Params = {
    params: Promise<{
        allianceId: string;
        memberId: string;
    }>
}

export default async function MemberPage({ params }: Params) {
    const { allianceId, memberId } = await params;
    const auth = await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.VIEW_MEMBERS,
    });

    // Load the member
    const allianceMember = await prisma.allianceMember.findUnique({
        where: { id: memberId },
    });

    if (!allianceMember || allianceMember.allianceId !== allianceId) {
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

    // Query 2: AllianceMember's metric entries for the active period (if exists)
    // Skip query if no active metrics to avoid unnecessary DB round-trip
    const activeMetricIds = activePeriod?.periodMetrics.map((pm) => pm.metricId) ?? [];
    const memberEntries = activePeriod && activeMetricIds.length > 0
        ? await prisma.memberMetricEntry.findMany({
              where: {
                  allianceMemberId: allianceMember.id,
                  periodId: activePeriod.id,
                  metricId: { in: activeMetricIds },
              },
              select: {
                  metricId: true,
                  value: true,
                  recordedAt: true,
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

    // Build performance section props as discriminated union
    const performanceProps: import("./MemberPerformanceSection").MemberPerformanceProps =
        !activePeriod
            ? { emptyState: "no-period" }
            : activePeriod.periodMetrics.length === 0
            ? { emptyState: "no-metrics", periodName: activePeriod.name }
            : { emptyState: "has-metrics", periodName: activePeriod.name, metrics: performanceMetrics };

    // Query 3: Leadership notes
    const leadershipNotes = await prisma.leadershipNote.findMany({
        where: {
            allianceMemberId: memberId,
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


    // Use permissions from auth context
    const { permissions, user } = auth;

    // Query linked user info for account section
    const linkedUserInfo = allianceMember.userId
        ? await prisma.user.findUnique({
              where: { id: allianceMember.userId },
              select: { email: true },
          })
        : null;

    const linkedMembership = allianceMember.userId
        ? await prisma.allianceMembership.findUnique({
              where: {
                  allianceId_userId: {
                      allianceId,
                      userId: allianceMember.userId,
                  },
              },
              select: { role: true },
          })
        : null;

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
            {allianceMember.archivedAt && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                    <p className="text-amber-800 font-medium">
                        This member was archived on{" "}
                        {allianceMember.archivedAt.toLocaleDateString()}
                    </p>
                    <p className="text-sm text-amber-600 mt-1">
                        Historical data is preserved but they will not appear in active member lists.
                    </p>
                </div>
            )}

            <section className="flex flex-col items-center justify-center">
                <h1 className="text-2xl font-bold">{allianceMember.playerName}</h1>
                {allianceMember.role && (
                    <div className="text-sm text-blue-600 font-medium mt-1">
                        {allianceMember.role}
                    </div>
                )}
                <div className="text-sm text-gray-500 mt-2">
                    THP: {allianceMember.thp == null ? "—" : formatPower(allianceMember.thp)}
                </div>
                <div className="text-sm text-gray-500">
                    Top Squad: {allianceMember.squadPower == null ? "—" : formatPower(allianceMember.squadPower)}
                </div>
                {allianceMember.joinedAt && (
                    <div className="text-sm text-gray-400 mt-2">
                        Joined {allianceMember.joinedAt.toLocaleDateString()}
                    </div>
                )}
                {permissions.canManageMembers && (
                    <MemberActions
                        allianceId={allianceId}
                        memberId={allianceMember.id}
                        isArchived={!!allianceMember.archivedAt}
                    />
                )}
            </section>

            {linkedUserInfo && linkedMembership ? (
                <MemberAccountSection
                    allianceId={allianceId}
                    canInvite={permissions.canInviteCollaborators}
                    connected={true}
                    email={linkedUserInfo.email}
                    membershipRole={linkedMembership.role}
                />
            ) : (
                <MemberAccountSection
                    allianceId={allianceId}
                    canInvite={permissions.canInviteCollaborators}
                    connected={false}
                />
            )}

            <MemberPerformanceSection {...performanceProps} />

            <section className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-center text-gray-900">Leadership Notes</h2>
                <LeadershipNoteCard allianceId={allianceId} memberId={allianceMember.id} mode="create" />
                {leadershipNotes.length > 0 ? (
                    leadershipNotes.map((note) => (
                        <LeadershipNoteCard
                            key={note.id}
                            allianceId={allianceId}
                            memberId={allianceMember.id}
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
