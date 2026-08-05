import type { Prisma } from "@/app/generated/prisma/client";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";

// The subset of MemberImportChange columns this module reads. Kept as an
// explicit type (rather than inferring from a `select`) so both the preview
// page and the rollback action can build this shape from their own queries
// without importing Prisma's generated payload types.
export type ImportChangeForRollbackPreview = {
    id: string;
    memberImportId: string;
    allianceMemberId: string | null;
    playerNameSnapshot: string;
    sourceRow: number;
    changeType: MemberImportChangeType;
    archivedAtAfter: Date | null;
    thpAfter: number | null;
    roleAfter: string | null;
    discordNameAfter: string | null;
    squadPowerAfter: number | null;
    joinedAtAfter: Date | null;
    userIdAfter: string | null;
    memberUpdatedAtAfter: Date;
};

type LiveMemberForDriftCheck = {
    thp: number | null;
    role: string | null;
    archivedAt: Date | null;
    discordName: string | null;
    squadPower: number | null;
    joinedAt: Date | null;
    userId: string | null;
    updatedAt: Date;
};

type DriftCheckedField =
    | "thp"
    | "role"
    | "archivedAt"
    | "discordName"
    | "squadPower"
    | "joinedAt"
    | "userId"
    | "updatedAt";

// The eight mutable fields whose current (live) value is compared against
// this change's recorded "after" snapshot. Any drift here means the
// member's state has moved on since the import — the row-atomic v1
// contract (see #277 PR 3 design discussion) is "any drift means touch
// nothing", so a single drifted field disqualifies the whole row from
// automatic rollback exactly the same as every field drifting. `updatedAt`
// pairs with `memberUpdatedAtAfter` rather than a same-named "after" column
// — see MemberImportChange's own doc comment on why that's independent,
// corroborating evidence rather than a version counter.
const DRIFT_CHECKED_FIELDS: {
    label: DriftCheckedField;
    live: (m: LiveMemberForDriftCheck) => unknown;
    after: (c: ImportChangeForRollbackPreview) => unknown;
}[] = [
    { label: "thp", live: (m) => m.thp, after: (c) => c.thpAfter },
    { label: "role", live: (m) => m.role, after: (c) => c.roleAfter },
    { label: "archivedAt", live: (m) => m.archivedAt, after: (c) => c.archivedAtAfter },
    { label: "discordName", live: (m) => m.discordName, after: (c) => c.discordNameAfter },
    { label: "squadPower", live: (m) => m.squadPower, after: (c) => c.squadPowerAfter },
    { label: "joinedAt", live: (m) => m.joinedAt, after: (c) => c.joinedAtAfter },
    { label: "userId", live: (m) => m.userId, after: (c) => c.userIdAfter },
    { label: "updatedAt", live: (m) => m.updatedAt, after: (c) => c.memberUpdatedAtAfter },
];

export type RollbackPreviewItem = {
    changeId: string;
    playerNameSnapshot: string;
    sourceRow: number;
    changeType: MemberImportChangeType;
    allianceMemberId: string | null;
    // null only when the member no longer exists at all (see
    // MEMBER_MISSING handling below) — otherwise reflects its live state.
    currentlyArchived: boolean | null;
    hasConflict: boolean;
    driftedFields: DriftCheckedField[];
    hadLaterImportInvolvement: boolean;
    hadLinkedUser: boolean;
    metricEntryCount: number;
    leadershipNoteCount: number;
    invitationCount: number;
    /**
     * True only for a CREATED conflict on a currently-active member — the
     * one case with a genuine, safe two-way choice (Keep active / Archive
     * and preserve history). Every other outcome (clean DELETED/REVERTED,
     * an already-archived CREATED conflict, or any RESTORED conflict) has
     * exactly one safe resolution and is never owner-actionable.
     */
    requiresResolution: boolean;
    /**
     * The resolution this row will receive if left as-is. Non-null for
     * every row except a `requiresResolution` one, which has no default —
     * see #277 PR 3's "no preselection" requirement.
     */
    defaultResolution:
        | "DELETED"
        | "REVERTED_TO_PRE_IMPORT_STATE"
        | "RETAINED_ARCHIVED"
        | "SKIPPED_CONFLICT"
        | null;
};

export type RollbackPreview = {
    memberImportId: string;
    items: RollbackPreviewItem[];
};

function fieldsDiffer(a: unknown, b: unknown): boolean {
    if (a instanceof Date || b instanceof Date) {
        const aTime = a instanceof Date ? a.getTime() : a;
        const bTime = b instanceof Date ? b.getTime() : b;
        return aTime !== bTime;
    }
    return a !== b;
}

/**
 * Computes, for one MemberImport's full set of changes, exactly what a
 * rollback would do to each affected member right now.
 *
 * Deliberately the *only* place this classification is implemented: the
 * undo page calls it read-only (plain `prisma`) to render a preview, and
 * `rollbackImport` calls it again with the same shape *inside*
 * `withAllianceMemberLock` immediately before committing, so the two can
 * never drift out of sync with each other. A caller re-running this
 * immediately before execution — rather than trusting the page's earlier
 * preview — is what makes the transactional re-validation in #277 PR 3's
 * design actually safe against a conflicting edit that landed in between.
 *
 * `client` accepts a `Prisma.TransactionClient` structurally: the plain
 * `prisma` singleton also satisfies that shape (it's a strict superset),
 * so the same function runs identically inside or outside a transaction.
 */
export async function computeImportRollbackPreview(
    client: Prisma.TransactionClient,
    memberImport: { id: string; createdAt: Date },
    changes: ImportChangeForRollbackPreview[]
): Promise<RollbackPreview> {
    const memberIds = changes
        .map((c) => c.allianceMemberId)
        .filter((id): id is string => id !== null);

    const liveMembers =
        memberIds.length === 0
            ? []
            : await client.allianceMember.findMany({
                  where: { id: { in: memberIds } },
                  select: {
                      id: true,
                      thp: true,
                      role: true,
                      archivedAt: true,
                      discordName: true,
                      squadPower: true,
                      joinedAt: true,
                      userId: true,
                      updatedAt: true,
                  },
              });
    const liveById = new Map(liveMembers.map((m) => [m.id, m]));

    // "Later-import involvement": any *other* MemberImportChange row for the
    // same member, from an import that ran strictly after this one
    // (createdAt, id) — not just "any other import", which would also flag
    // this member's own unrelated, legitimate earlier history (e.g. the
    // import that originally created a member later archived and then
    // restored by *this* import). Batched across the whole import rather
    // than per-row to keep this an O(1)-query check regardless of import
    // size.
    const laterInvolvementIds =
        memberIds.length === 0
            ? new Set<string>()
            : new Set(
                  (
                      await client.memberImportChange.findMany({
                          where: {
                              allianceMemberId: { in: memberIds },
                              memberImportId: { not: memberImport.id },
                              OR: [
                                  { memberImport: { createdAt: { gt: memberImport.createdAt } } },
                                  {
                                      memberImport: {
                                          createdAt: memberImport.createdAt,
                                          id: { gt: memberImport.id },
                                      },
                                  },
                              ],
                          },
                          select: { allianceMemberId: true },
                      })
                  )
                      .map((c) => c.allianceMemberId)
                      .filter((id): id is string => id !== null)
              );

    // Protected-dependency counts only matter for CREATED rows — a clean
    // RESTORED revert only ever touches archivedAt/thp/role, never deletes
    // the member, so nothing downstream is at risk either way.
    const createdMemberIds = changes
        .filter((c) => c.changeType === MemberImportChangeType.CREATED && c.allianceMemberId !== null)
        .map((c) => c.allianceMemberId as string);

    const [metricCounts, noteCounts, invitationCounts] =
        createdMemberIds.length === 0
            ? [[], [], []]
            : await Promise.all([
                  client.memberMetricEntry.groupBy({
                      by: ["allianceMemberId"],
                      where: { allianceMemberId: { in: createdMemberIds } },
                      _count: { _all: true },
                  }),
                  client.leadershipNote.groupBy({
                      by: ["allianceMemberId"],
                      where: { allianceMemberId: { in: createdMemberIds } },
                      _count: { _all: true },
                  }),
                  client.invitation.groupBy({
                      by: ["allianceMemberId"],
                      where: { allianceMemberId: { in: createdMemberIds } },
                      _count: { _all: true },
                  }),
              ]);
    const metricCountById = new Map(metricCounts.map((r) => [r.allianceMemberId, r._count._all]));
    const noteCountById = new Map(noteCounts.map((r) => [r.allianceMemberId, r._count._all]));
    const invitationCountById = new Map(
        invitationCounts
            .filter((r): r is typeof r & { allianceMemberId: string } => r.allianceMemberId !== null)
            .map((r) => [r.allianceMemberId, r._count._all])
    );

    const items: RollbackPreviewItem[] = changes.map((change) => {
        const live = change.allianceMemberId ? liveById.get(change.allianceMemberId) : undefined;

        // The member row itself is gone. No code path deletes an
        // AllianceMember today outside this very rollback feature, so this
        // is unreachable at ship time — but conflict detection must stay
        // conservative if that ever changes. There's no live state left to
        // safely act on either way, for either change type, so this
        // collapses to the same "touch nothing" outcome as any other
        // conflict.
        if (!live) {
            return {
                changeId: change.id,
                playerNameSnapshot: change.playerNameSnapshot,
                sourceRow: change.sourceRow,
                changeType: change.changeType,
                allianceMemberId: change.allianceMemberId,
                currentlyArchived: null,
                hasConflict: true,
                driftedFields: [],
                hadLaterImportInvolvement: false,
                hadLinkedUser: false,
                metricEntryCount: 0,
                leadershipNoteCount: 0,
                invitationCount: 0,
                requiresResolution: false,
                defaultResolution: "SKIPPED_CONFLICT",
            };
        }

        const driftedFields: DriftCheckedField[] = DRIFT_CHECKED_FIELDS.filter((field) =>
            fieldsDiffer(field.live(live), field.after(change))
        ).map((field) => field.label);

        const hadLaterImportInvolvement = laterInvolvementIds.has(live.id);
        const hadLinkedUser = live.userId !== null;
        const currentlyArchived = live.archivedAt !== null;

        if (change.changeType === MemberImportChangeType.CREATED) {
            const metricEntryCount = metricCountById.get(live.id) ?? 0;
            const leadershipNoteCount = noteCountById.get(live.id) ?? 0;
            const invitationCount = invitationCountById.get(live.id) ?? 0;

            const hasConflict =
                driftedFields.length > 0 ||
                hadLaterImportInvolvement ||
                hadLinkedUser ||
                metricEntryCount > 0 ||
                leadershipNoteCount > 0 ||
                invitationCount > 0;

            if (!hasConflict) {
                return {
                    changeId: change.id,
                    playerNameSnapshot: change.playerNameSnapshot,
                    sourceRow: change.sourceRow,
                    changeType: change.changeType,
                    allianceMemberId: change.allianceMemberId,
                    currentlyArchived,
                    hasConflict: false,
                    driftedFields,
                    hadLaterImportInvolvement,
                    hadLinkedUser,
                    metricEntryCount,
                    leadershipNoteCount,
                    invitationCount,
                    requiresResolution: false,
                    defaultResolution: "DELETED",
                };
            }

            // Already archived: retaining archived is the only safe
            // outcome. Never offer a choice that would reactivate a member
            // as a side effect of an unrelated rollback decision.
            if (currentlyArchived) {
                return {
                    changeId: change.id,
                    playerNameSnapshot: change.playerNameSnapshot,
                    sourceRow: change.sourceRow,
                    changeType: change.changeType,
                    allianceMemberId: change.allianceMemberId,
                    currentlyArchived,
                    hasConflict: true,
                    driftedFields,
                    hadLaterImportInvolvement,
                    hadLinkedUser,
                    metricEntryCount,
                    leadershipNoteCount,
                    invitationCount,
                    requiresResolution: false,
                    defaultResolution: "RETAINED_ARCHIVED",
                };
            }

            // Currently active with a real conflict: a genuine two-way
            // choice exists (Keep active / Archive and preserve history).
            // No default — the owner must pick explicitly.
            return {
                changeId: change.id,
                playerNameSnapshot: change.playerNameSnapshot,
                sourceRow: change.sourceRow,
                changeType: change.changeType,
                allianceMemberId: change.allianceMemberId,
                currentlyArchived,
                hasConflict: true,
                driftedFields,
                hadLaterImportInvolvement,
                hadLinkedUser,
                metricEntryCount,
                leadershipNoteCount,
                invitationCount,
                requiresResolution: true,
                defaultResolution: null,
            };
        }

        // RESTORED: never actionable once conflicted — there's no safe
        // partial revert once any tracked field has drifted, so the only
        // two outcomes are a full revert or leaving it untouched.
        const hasConflict = driftedFields.length > 0 || hadLaterImportInvolvement;
        return {
            changeId: change.id,
            playerNameSnapshot: change.playerNameSnapshot,
            sourceRow: change.sourceRow,
            changeType: change.changeType,
            allianceMemberId: change.allianceMemberId,
            currentlyArchived,
            hasConflict,
            driftedFields,
            hadLaterImportInvolvement,
            hadLinkedUser,
            metricEntryCount: 0,
            leadershipNoteCount: 0,
            invitationCount: 0,
            requiresResolution: false,
            defaultResolution: hasConflict ? "SKIPPED_CONFLICT" : "REVERTED_TO_PRE_IMPORT_STATE",
        };
    });

    return { memberImportId: memberImport.id, items };
}
