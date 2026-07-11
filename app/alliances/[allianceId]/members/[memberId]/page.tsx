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
import { PageLayout, Card, Badge } from "@/app/src/components";

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

    const allianceMember = await prisma.allianceMember.findFirst({
        where: { id: memberId, allianceId },
    });

    if (!allianceMember) {
        notFound();
    }

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

    const entriesByMetric = new Map<string, typeof memberEntries>();
    for (const entry of memberEntries) {
        const list = entriesByMetric.get(entry.metricId) || [];
        if (list.length < 2) {
            list.push(entry);
            entriesByMetric.set(entry.metricId, list);
        }
    }

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

    const performanceProps: import("./MemberPerformanceSection").MemberPerformanceProps =
        !activePeriod
            ? { emptyState: "no-period" }
            : activePeriod.periodMetrics.length === 0
            ? { emptyState: "no-metrics", periodName: activePeriod.name }
            : { emptyState: "has-metrics", periodName: activePeriod.name, metrics: performanceMetrics };

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

    const { permissions, user } = auth;

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
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Members", href: `/alliances/${allianceId}/members` },
                { label: allianceMember.playerName },
            ]}
            title={allianceMember.playerName}
        >
            <div className="flex flex-col gap-8">
                {allianceMember.archivedAt && (
                    <Card className="bg-warning-muted border-warning">
                        <Card.Body>
                            <div className="text-center">
                                <p className="text-warning font-medium">
                                    This member was archived on{" "}
                                    {allianceMember.archivedAt.toLocaleDateString()}
                                </p>
                                <p className="text-sm text-warning/80 mt-1">
                                    Historical data is preserved but they will not appear in active member lists.
                                </p>
                            </div>
                        </Card.Body>
                    </Card>
                )}

                <Card>
                    <Card.Body>
                        <div className="flex flex-col items-center justify-center py-4">
                            <h2 className="text-2xl font-bold text-primary">{allianceMember.playerName}</h2>
                            {allianceMember.role && (
                                <Badge variant="info" className="mt-2">
                                    {allianceMember.role}
                                </Badge>
                            )}
                            <div className="flex gap-6 mt-4 text-sm text-text-secondary">
                                <div>
                                    <span className="text-text-muted">THP:</span>{" "}
                                    {allianceMember.thp == null ? "—" : formatPower(allianceMember.thp)}
                                </div>
                                <div>
                                    <span className="text-text-muted">Top Squad:</span>{" "}
                                    {allianceMember.squadPower == null ? "—" : formatPower(allianceMember.squadPower)}
                                </div>
                            </div>
                            {allianceMember.joinedAt && (
                                <div className="text-sm text-text-muted mt-2">
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
                        </div>
                    </Card.Body>
                </Card>

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
                    <h2 className="text-xl font-bold text-center text-primary">Leadership Notes</h2>
                    {permissions.canManageNotes && (
                        <LeadershipNoteCard allianceId={allianceId} memberId={allianceMember.id} mode="create" />
                    )}
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
                                    canEdit: note.author.id === user.id && permissions.canManageNotes,
                                }}
                            />
                        ))
                    ) : (
                        <div className="text-sm text-text-muted text-center py-4">
                            No leadership notes yet.
                        </div>
                    )}
                </section>
            </div>
        </PageLayout>
    );
}
