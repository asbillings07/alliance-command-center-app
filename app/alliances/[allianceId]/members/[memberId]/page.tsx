import { notFound, redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import {
    metricPeriodChronologicalOrderBy,
    pickCurrentMetricPeriod,
    findOlderMetricPeriods,
} from "@/app/src/lib/metricPeriodOrdering";
import {
    resolveComparePeriodSelection,
    formatComparePeriodLabels,
    NO_COMPARISON_PARAM,
    NO_PRIOR_PERIOD_PARAM,
    type ComparePeriodSelection,
} from "./comparePeriodSelection";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";
import { formatPower } from "@/app/src/lib/formatPower";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { LeadershipNoteCard } from "./LeadershipNoteCard";
import { MemberPerformanceSection } from "./MemberPerformanceSection";
import type { MemberPerformanceProps } from "./MemberPerformanceSection";
import { buildCurrentMetricViewModels, buildPeriodTrendViewModels } from "./memberPerformanceViewModel";
import { MemberActions } from "./MemberActions";
import { MemberAccountSection } from "./MemberAccountSection";
import { MemberPeriodSelector } from "./MemberPeriodSelector";
import { MemberComparePeriodSelector } from "./MemberComparePeriodSelector";
import { PageLayout, Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
    params: Promise<{
        allianceId: string;
        memberId: string;
    }>;
    searchParams: Promise<{
        periodId?: string;
        comparePeriodId?: string;
    }>;
}

/**
 * Resolves the query-param value a canonical URL must carry for a given
 * `ComparePeriodSelection` - shared by the redirect below and by whatever
 * gets passed down to the client selectors as `chosenComparePeriodId`.
 * `"invalid"` is unreachable here: callers must `notFound()` on that status
 * before ever calling this.
 */
function canonicalCompareParam(selection: ComparePeriodSelection): string {
    switch (selection.status) {
        case "period":
            return selection.comparePeriod.id;
        case "explicit-none":
            return NO_COMPARISON_PARAM;
        case "no-prior-period":
            return NO_PRIOR_PERIOD_PARAM;
        case "invalid":
            throw new Error("canonicalCompareParam called with an invalid selection - check status first");
    }
}

export default async function MemberPage({ params, searchParams }: Params) {
    const { allianceId, memberId } = await params;
    const { periodId: requestedPeriodId, comparePeriodId: requestedComparePeriodId } = await searchParams;

    const auth = await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.VIEW_MEMBERS,
    });
    const { permissions, user } = auth;

    const allianceMember = await prisma.allianceMember.findFirst({
        where: { id: memberId, allianceId },
    });

    if (!allianceMember) {
        notFound();
    }

    const allPeriods = await prisma.metricPeriod.findMany({
        where: { allianceId },
        orderBy: metricPeriodChronologicalOrderBy,
        select: {
            id: true,
            name: true,
            active: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
        },
    });

    if (requestedPeriodId && !allPeriods.some((p) => p.id === requestedPeriodId)) {
        notFound();
    }

    const selectedPeriodHeader = requestedPeriodId
        ? allPeriods.find((p) => p.id === requestedPeriodId)
        : pickCurrentMetricPeriod(allPeriods.filter((p) => p.active))
            ?? pickCurrentMetricPeriod(allPeriods);

    // #349: resolve the explicit "Compare with" selection (and canonicalize
    // the URL if either param was implicit) before any of the expensive
    // reads below - see comparePeriodSelection.ts's doc comment for why the
    // four possible outcomes must stay distinct, and the plan's
    // "Canonicalization strategy" section for why this must run here, not
    // after `priorPeriodHeader` was derived like the pre-#349 code did.
    if (!selectedPeriodHeader && requestedComparePeriodId !== undefined) {
        // A comparison was requested with nothing to be primary - the
        // concept doesn't apply when there's no period at all.
        notFound();
    }

    const eligibleComparePeriods = selectedPeriodHeader
        ? findOlderMetricPeriods(allPeriods, selectedPeriodHeader.id)
        : [];

    const compareSelection = selectedPeriodHeader
        ? resolveComparePeriodSelection({ requestedComparePeriodId, eligiblePeriods: eligibleComparePeriods })
        : null;

    if (compareSelection?.status === "invalid") {
        notFound();
    }

    const needsCanonicalRedirect =
        !!selectedPeriodHeader && (requestedPeriodId === undefined || requestedComparePeriodId === undefined);

    if (needsCanonicalRedirect && compareSelection) {
        const canonicalPeriodId = encodeURIComponent(selectedPeriodHeader!.id);
        const canonicalComparePeriodId = encodeURIComponent(canonicalCompareParam(compareSelection));
        redirect(
            `/alliances/${allianceId}/members/${memberId}?periodId=${canonicalPeriodId}&comparePeriodId=${canonicalComparePeriodId}`,
        );
    }

    const compareLabelsById = formatComparePeriodLabels(eligibleComparePeriods);

    const selectedPeriod = selectedPeriodHeader
        ? await prisma.metricPeriod.findUnique({
              where: { id: selectedPeriodHeader.id },
              include: {
                  periodMetrics: {
                      where: { active: true },
                      include: {
                          metric: true,
                      },
                  },
              },
          })
        : null;

    const activeMetricIds = selectedPeriod?.periodMetrics.map((pm) => pm.metricId) ?? [];
    // Shared by both buildCurrentMetricViewModels (ignores trendDirection)
    // and buildPeriodTrendViewModels (uses it for favorable/adverse
    // coloring, #323) - one Metric-joined row per period metric already
    // has everything either function needs.
    const periodMetricInputs = selectedPeriod?.periodMetrics.map((pm) => ({
        metricId: pm.metricId,
        metricName: pm.metric.name,
        trendDirection: pm.metric.trendDirection,
    })) ?? [];
    // buildCurrentMetricViewModels (memberPerformanceViewModel.ts) explains
    // why this stays a raw MemberMetricEntry history query rather than
    // moving to the canonical memberPeriodMetricValues read model like other
    // #287 Slice 3 consumers - read that module doc before changing this.
    const rawMemberEntries = selectedPeriod && activeMetricIds.length > 0
        ? await prisma.memberMetricEntry.findMany({
              where: {
                  allianceMemberId: allianceMember.id,
                  periodId: selectedPeriod.id,
                  metricId: { in: activeMetricIds },
              },
              select: {
                  metricId: true,
                  value: true,
                  recordedAt: true,
                  createdAt: true,
                  id: true,
              },
              orderBy: [
                  { metricId: "asc" },
                  { recordedAt: "desc" },
                  { createdAt: "desc" },
                  { id: "desc" },
              ],
          })
        : [];

    // #321/#322: the prior-period trend is sourced entirely from the
    // canonical memberPeriodMetricValues read model (ADR-018 §6), not from
    // rawMemberEntries above - see buildPeriodTrendViewModels' doc comment
    // for why mixing the two sources for one card's arithmetic would be a
    // correctness trap. `priorPeriodHeader` null (vs. an empty rollup
    // result) is what distinguishes "New"/explicit "No comparison" from
    // "N/A" - see comparePeriodSelection.ts's doc comment. #349: this is now
    // whichever period (if any) the leader's explicit "Compare with"
    // selection resolved to, not just "the chronologically adjacent one."
    const priorPeriodHeader = compareSelection?.status === "period" ? compareSelection.comparePeriod : null;

    const [currentPeriodRollup, priorPeriodRollup] = selectedPeriod && activeMetricIds.length > 0
        ? await Promise.all([
              memberPeriodMetricValues(allianceId, selectedPeriod.id, activeMetricIds, {
                  memberIds: [allianceMember.id],
              }),
              priorPeriodHeader
                  ? memberPeriodMetricValues(allianceId, priorPeriodHeader.id, activeMetricIds, {
                        memberIds: [allianceMember.id],
                    })
                  : Promise.resolve(null),
          ])
        : [[], null];

    // #349: an active opt-out (`explicit-none`) must render no badge at all
    // - distinct from `no-prior-period`, which still passes a `null` prior
    // rollup through to `buildPeriodTrendViewModels` exactly as before,
    // preserving the existing, truthful "New" badge.
    const periodTrends = !selectedPeriod
        ? new Map()
        : compareSelection?.status === "explicit-none"
        ? new Map()
        : buildPeriodTrendViewModels(periodMetricInputs, currentPeriodRollup, priorPeriodRollup);

    const performanceMetrics = selectedPeriod
        ? buildCurrentMetricViewModels(periodMetricInputs, rawMemberEntries).map((metric) => ({
              ...metric,
              // A void/never-recorded current has no trend to show - see
              // buildPeriodTrendViewModels' doc comment.
              periodTrend: metric.current !== undefined ? periodTrends.get(metric.metricId) : undefined,
          }))
        : [];

    const periodSelector = selectedPeriod && compareSelection ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <MemberPeriodSelector
                allianceId={allianceId}
                memberId={memberId}
                selectedPeriodId={selectedPeriod.id}
                periods={allPeriods}
                chosenComparePeriodId={canonicalCompareParam(compareSelection)}
            />
            <MemberComparePeriodSelector
                allianceId={allianceId}
                memberId={memberId}
                selectedPeriodId={selectedPeriod.id}
                chosenComparePeriodId={canonicalCompareParam(compareSelection)}
                options={eligibleComparePeriods.map((period) => ({
                    id: period.id,
                    label: compareLabelsById.get(period.id)!,
                }))}
            />
        </div>
    ) : undefined;

    // #349: this used to also require `!requestedPeriodId`, to distinguish
    // "the system silently fell back here" from "the leader explicitly
    // picked this exact period." That distinction can no longer be read
    // from the URL: canonicalization (above) makes `periodId` explicit on
    // the very first render, so every subsequent visit to the same
    // canonical, shareable link - including the auto-fallback's own - would
    // otherwise regress to "Inactive Period" instead of this label. Purely
    // data-driven ("no active period exists anywhere, and this is the
    // newest one") is both the only signal that survives canonicalization
    // and arguably the more correct one for a reproducible link: it's true
    // regardless of how the visitor arrived.
    const isAutoFallbackToLatestInactive =
        !allPeriods.some((p) => p.active) &&
        selectedPeriodHeader?.id === allPeriods[0]?.id;

    const periodStatusLabel = selectedPeriod && !selectedPeriod.active
        ? isAutoFallbackToLatestInactive
            ? "Latest Period · Not active"
            : "Inactive Period"
        : undefined;

    const allUnrecorded =
        performanceMetrics.length > 0 &&
        performanceMetrics.every((metric) => metric.current === undefined);

    const membersBreadcrumbHref = `/alliances/${allianceId}/members${selectedPeriod ? `?periodId=${selectedPeriod.id}` : ""}`;

    const recordImportActions =
        selectedPeriod && permissions.canImportMetrics ? (
            <div className="mt-3 flex gap-3 flex-wrap justify-center">
                <Button
                    variant="primary"
                    href={`/alliances/${allianceId}/periods/${selectedPeriod.id}/record`}
                >
                    Record Results
                </Button>
                <Button
                    variant="secondary"
                    href={`/alliances/${allianceId}/periods/${selectedPeriod.id}/import`}
                >
                    Import Evaluation Results
                </Button>
            </div>
        ) : null;

    const performanceAction = !selectedPeriod
        ? permissions.canConfigurePeriods
            ? <Button variant="primary" href={`/alliances/${allianceId}/periods`}>Manage Periods</Button>
            : <Button variant="secondary" href={`/alliances/${allianceId}`}>Back to Dashboard</Button>
        : selectedPeriod.periodMetrics.length === 0
        ? permissions.canConfigurePeriods
            ? <Button variant="primary" href={`/alliances/${allianceId}/periods/${selectedPeriod.id}`}>Manage Period Metrics</Button>
            : <Button variant="secondary" href={`/alliances/${allianceId}`}>Back to Dashboard</Button>
        : undefined;

    const performanceProps: MemberPerformanceProps =
        !selectedPeriod
            ? { emptyState: "no-period", periodSelector, action: performanceAction }
            : selectedPeriod.periodMetrics.length === 0
            ? { emptyState: "no-metrics", periodName: selectedPeriod.name, periodSelector, periodStatusLabel, action: performanceAction }
            : {
                  emptyState: "has-metrics",
                  periodName: selectedPeriod.name,
                  metrics: performanceMetrics,
                  // #349: the disambiguated label (never the bare, possibly
                  // non-unique `.name`) for whichever period the leader's
                  // explicit "Compare with" selection resolved to.
                  previousPeriodName: priorPeriodHeader ? compareLabelsById.get(priorPeriodHeader.id) : undefined,
                  periodSelector,
                  periodStatusLabel,
                  unrecordedNotice: allUnrecorded
                      ? allianceMember.archivedAt
                          ? (
                              <p>
                                  No results were recorded for this period. This member is archived;
                                  historical results are read-only.
                              </p>
                          )
                          : (
                              <>
                                  <p>
                                      No results were recorded for this member in this evaluation period yet.
                                  </p>
                                  {recordImportActions}
                              </>
                          )
                      : undefined,
              };

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
                { label: "Members", href: membersBreadcrumbHref },
                { label: allianceMember.playerName },
            ]}
            title={allianceMember.playerName}
        >
            <div className="flex flex-col gap-8">
                {allianceMember.archivedAt && (
                    <Card className="bg-warning/10 border-warning">
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
