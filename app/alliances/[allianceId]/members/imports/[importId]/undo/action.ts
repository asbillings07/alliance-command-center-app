"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { Prisma } from "@/app/generated/prisma/client";
import {
    MemberImportRollbackOutcome,
    MemberImportRollbackResultResolution,
} from "@/app/generated/prisma/enums";
import {
    computeImportRollbackPreview,
    computePreviewFingerprint,
    type LiveMemberForDriftCheck,
} from "../rollbackPreview";

export type RollbackResolutionChoice = "RETAIN_ACTIVE" | "ARCHIVE_PRESERVING_HISTORY";

export type RollbackImportSummary = {
    outcome: MemberImportRollbackOutcome;
    deletedCount: number;
    revertedCount: number;
    retainedActiveCount: number;
    archivedPreservingHistoryCount: number;
    retainedArchivedCount: number;
    skippedConflictCount: number;
};

export type RollbackImportResult = ({ success: true } & RollbackImportSummary) | { success: false; error: string };

/**
 * Tags the intentional, safe-to-surface rejections inside this action's
 * transaction (not found, already rolled back, or a preview gone stale) so
 * the outer catch can convert *only* those into a `{ success: false, error
 * }` result — matches bulk-actions.ts's CapacityLimitError precedent. Any
 * other thrown error rethrows rather than being stringified for the client.
 */
class RollbackValidationError extends Error {}

const RESOLUTION_FIELD_PREFIX = "resolution:";

/** Reads `resolution:<changeId>` fields, ignoring anything else on the form
 * (including a stray `allianceId`/`importId`) and any value that isn't one
 * of the two real choices. */
function parseResolutions(formData: FormData): Map<string, RollbackResolutionChoice> {
    const resolutions = new Map<string, RollbackResolutionChoice>();
    for (const [key, value] of formData.entries()) {
        if (!key.startsWith(RESOLUTION_FIELD_PREFIX) || typeof value !== "string") continue;
        if (value !== "RETAIN_ACTIVE" && value !== "ARCHIVE_PRESERVING_HISTORY") continue;
        resolutions.set(key.slice(RESOLUTION_FIELD_PREFIX.length), value);
    }
    return resolutions;
}

/**
 * The `where` clause for this item's mutation, pinned to the exact live
 * values `computeImportRollbackPreview` read moments ago inside this same
 * transaction. `withAllianceMemberLock`'s row lock is on `Alliance`, not on
 * this specific `AllianceMember` — it serializes against other
 * capacity-checked mutations (bulk/single restore, add member, ...), not
 * against an ordinary `updateMember`/`archiveMember` call on this row, and
 * even a second read inside the *same* transaction isn't guaranteed to
 * still see what the first one saw under Postgres's default READ COMMITTED
 * isolation. Guarding the write itself — rather than trusting the earlier
 * read — is what makes a concurrent edit to this exact member fail the
 * match (0 rows) instead of being silently overwritten. Never called for a
 * `liveSnapshot: null` item (the member-missing case never reaches a
 * mutation branch).
 */
function buildLiveGuardWhere(allianceMemberId: string, liveSnapshot: LiveMemberForDriftCheck) {
    return {
        id: allianceMemberId,
        thp: liveSnapshot.thp,
        role: liveSnapshot.role,
        archivedAt: liveSnapshot.archivedAt,
        discordName: liveSnapshot.discordName,
        squadPower: liveSnapshot.squadPower,
        joinedAt: liveSnapshot.joinedAt,
        userId: liveSnapshot.userId,
        updatedAt: liveSnapshot.updatedAt,
    };
}

const STALE_PREVIEW_MESSAGE =
    "This import's state changed since you loaded this page. Review the updated preview and try again.";

/** Throws unless exactly one row matched a guarded `updateMany`/`deleteMany`
 * (see `buildLiveGuardWhere`) — anything else means this member changed out
 * from under this rollback and the whole transaction must abort rather than
 * commit a mutation against evidence that's no longer current. */
function assertGuardedMutationMatched(count: number): void {
    if (count !== 1) {
        throw new RollbackValidationError(STALE_PREVIEW_MESSAGE);
    }
}

/**
 * Commits the undo of a single completed roster import (#277 PR 3).
 *
 * Everything — re-deriving the preview, cross-checking the caller's
 * resolutions against it, and executing the resulting mutations — happens
 * inside one `withAllianceMemberLock` transaction. The page's earlier
 * preview is only ever a suggestion to the user; this action never trusts
 * it. It recomputes `computeImportRollbackPreview` fresh here and requires
 * the fresh result to fingerprint-match exactly what the owner reviewed —
 * see `computePreviewFingerprint`'s doc comment for why a looser, per-row
 * check (e.g. only "does this row still require a choice") isn't enough:
 * evidence can change in ways that leave `requiresResolution` unchanged, or
 * change in ways that make it *stop* requiring one, and either would
 * otherwise let a submission the owner never actually saw get committed.
 *
 * Before that recomputation runs, every affected member is row-locked
 * (`SELECT ... FOR UPDATE`, batched) — `withAllianceMemberLock`'s own lock
 * is on `Alliance`, not on these specific rows. Locking them upfront closes
 * two distinct races: an ordinary `archiveMember`/`updateMember` edit
 * landing on one of them mid-transaction (an ordinary `UPDATE` needs the
 * same row lock we're already holding, so it simply waits), and a *new*
 * protected dependency (an invitation, metric entry, or leadership note)
 * being created for one of them — Postgres itself takes an implicit
 * `FOR KEY SHARE` lock on the referenced member row to validate that
 * foreign key, which conflicts with our `FOR UPDATE` the same way. Either
 * kind of concurrent write is therefore forced to wait until this
 * transaction fully commits or rolls back, so `computeImportRollbackPreview`
 * reads a value for every locked member that cannot change again before
 * this transaction's mutations run. Every mutation is additionally guarded
 * against those exact live scalar values (see `buildLiveGuardWhere`) as
 * defense in depth — by construction it can never actually miss once the
 * lock above holds, but it keeps the guarantee explicit and independently
 * testable rather than implicit in lock ordering alone.
 */
export async function rollbackImport(formData: FormData): Promise<RollbackImportResult> {
    const allianceId = formData.get("allianceId");
    const importId = formData.get("importId");
    const previewFingerprint = formData.get("previewFingerprint");
    if (
        typeof allianceId !== "string" ||
        allianceId.trim() === "" ||
        typeof importId !== "string" ||
        importId.trim() === "" ||
        typeof previewFingerprint !== "string" ||
        previewFingerprint.trim() === ""
    ) {
        return { success: false, error: "Invalid request" };
    }

    const auth = await requireAllianceAccess({ allianceId });
    if (!auth.permissions.canRollbackMemberImports) {
        return { success: false, error: "You don't have permission to undo a member import" };
    }

    const resolutions = parseResolutions(formData);

    try {
        const summary = await withAllianceMemberLock(allianceId, async (tx) => {
            // Scoped by both id and allianceId, matching the detail page's
            // own lookup — an importId from another alliance is indistinguishable
            // from a nonexistent one.
            const memberImport = await tx.memberImport.findFirst({
                where: { id: importId, allianceId },
                select: {
                    id: true,
                    createdAt: true,
                    rollback: { select: { id: true } },
                    changes: {
                        select: {
                            id: true,
                            memberImportId: true,
                            allianceMemberId: true,
                            playerNameSnapshot: true,
                            sourceRow: true,
                            changeType: true,
                            archivedAtBefore: true,
                            archivedAtAfter: true,
                            thpBefore: true,
                            thpAfter: true,
                            roleBefore: true,
                            roleAfter: true,
                            discordNameAfter: true,
                            squadPowerAfter: true,
                            joinedAtAfter: true,
                            userIdAfter: true,
                            memberUpdatedAtAfter: true,
                        },
                    },
                },
            });

            if (!memberImport) {
                throw new RollbackValidationError("This import could not be found.");
            }
            // memberImportId is @unique on MemberImportRollback — a rollback
            // is a single terminal operation, never retryable. This check is
            // the friendly early exit; the unique constraint is the actual
            // safety net against a genuine race between two submissions.
            if (memberImport.rollback) {
                throw new RollbackValidationError("This import has already been undone.");
            }

            // Row-lock every affected member *before* reading anything about
            // them — see this function's own doc comment for exactly which
            // races this closes. A plain `id IN (...)` (no FOR UPDATE) here
            // would still let a concurrent write land between this read and
            // the mutations below; FOR UPDATE makes that write wait instead.
            const memberIdsToLock = [
                ...new Set(
                    memberImport.changes
                        .map((c) => c.allianceMemberId)
                        .filter((id): id is string => id !== null)
                ),
            ];
            if (memberIdsToLock.length > 0) {
                await tx.$executeRaw(
                    Prisma.sql`SELECT id FROM "AllianceMember" WHERE id IN (${Prisma.join(memberIdsToLock)}) FOR UPDATE`
                );
            }

            const preview = await computeImportRollbackPreview(tx, memberImport, memberImport.changes);

            // The primary staleness guard: any difference at all between
            // what was rendered and what's true right now — not just "a row
            // that now needs a choice" — means this submission wasn't made
            // against current evidence. See computePreviewFingerprint.
            if (computePreviewFingerprint(preview.items) !== previewFingerprint) {
                throw new RollbackValidationError(STALE_PREVIEW_MESSAGE);
            }

            // Defense in depth: the fingerprint match above already proves
            // every `requiresResolution` row is identical to what was
            // rendered, so this should be unreachable via the real UI (it
            // disables confirming until every one has a selection) — but a
            // tampered submission could still match the fingerprint while
            // omitting a choice.
            for (const item of preview.items) {
                if (item.requiresResolution && !resolutions.has(item.changeId)) {
                    throw new RollbackValidationError(STALE_PREVIEW_MESSAGE);
                }
            }

            const changesById = new Map(memberImport.changes.map((c) => [c.id, c]));

            let deletedCount = 0;
            let revertedCount = 0;
            let retainedActiveCount = 0;
            let archivedPreservingHistoryCount = 0;
            let retainedArchivedCount = 0;
            let skippedConflictCount = 0;
            let anyMemberMutated = false;

            const resultRows: {
                memberImportChangeId: string;
                allianceMemberId: string | null;
                resolution: MemberImportRollbackResultResolution;
                driftedFields: string[];
                hadLaterImportInvolvement: boolean;
                hadLinkedUser: boolean;
                metricEntryCount: number;
                leadershipNoteCount: number;
                invitationCount: number;
            }[] = [];

            for (const item of preview.items) {
                const change = changesById.get(item.changeId)!;
                let resolution: MemberImportRollbackResultResolution;

                if (item.requiresResolution) {
                    // Presence already validated above; the value itself is
                    // constrained to the two real choices by parseResolutions.
                    const choice = resolutions.get(item.changeId)!;
                    if (choice === "RETAIN_ACTIVE") {
                        resolution = MemberImportRollbackResultResolution.RETAINED_ACTIVE;
                        retainedActiveCount++;
                    } else {
                        resolution = MemberImportRollbackResultResolution.ARCHIVED_PRESERVING_HISTORY;
                        archivedPreservingHistoryCount++;
                        const { count } = await tx.allianceMember.updateMany({
                            where: buildLiveGuardWhere(change.allianceMemberId!, item.liveSnapshot!),
                            data: { archivedAt: new Date() },
                        });
                        assertGuardedMutationMatched(count);
                        anyMemberMutated = true;
                    }
                } else {
                    switch (item.defaultResolution) {
                        case "DELETED": {
                            resolution = MemberImportRollbackResultResolution.DELETED;
                            deletedCount++;
                            const { count } = await tx.allianceMember.deleteMany({
                                where: buildLiveGuardWhere(change.allianceMemberId!, item.liveSnapshot!),
                            });
                            assertGuardedMutationMatched(count);
                            anyMemberMutated = true;
                            break;
                        }
                        case "REVERTED_TO_PRE_IMPORT_STATE": {
                            resolution = MemberImportRollbackResultResolution.REVERTED_TO_PRE_IMPORT_STATE;
                            revertedCount++;
                            const { count } = await tx.allianceMember.updateMany({
                                where: buildLiveGuardWhere(change.allianceMemberId!, item.liveSnapshot!),
                                data: {
                                    archivedAt: change.archivedAtBefore,
                                    thp: change.thpBefore,
                                    role: change.roleBefore,
                                },
                            });
                            assertGuardedMutationMatched(count);
                            anyMemberMutated = true;
                            break;
                        }
                        case "RETAINED_ARCHIVED":
                            resolution = MemberImportRollbackResultResolution.RETAINED_ARCHIVED;
                            retainedArchivedCount++;
                            break;
                        case "SKIPPED_CONFLICT":
                        default:
                            resolution = MemberImportRollbackResultResolution.SKIPPED_CONFLICT;
                            skippedConflictCount++;
                            break;
                    }
                }

                resultRows.push({
                    memberImportChangeId: item.changeId,
                    // A DELETED resolution just removed this row from
                    // AllianceMember in this same transaction — referencing
                    // it here would violate the FK immediately (Postgres
                    // checks it per-statement, not deferred). null is also
                    // the semantically correct value: the member is gone,
                    // and MemberImportChange.playerNameSnapshot (reachable
                    // via the Restrict'd FK on memberImportChangeId) is what
                    // keeps this row readable regardless.
                    allianceMemberId: resolution === MemberImportRollbackResultResolution.DELETED
                        ? null
                        : item.allianceMemberId,
                    resolution,
                    driftedFields: item.driftedFields,
                    hadLaterImportInvolvement: item.hadLaterImportInvolvement,
                    hadLinkedUser: item.hadLinkedUser,
                    metricEntryCount: item.metricEntryCount,
                    leadershipNoteCount: item.leadershipNoteCount,
                    invitationCount: item.invitationCount,
                });
            }

            if (anyMemberMutated) {
                await touchAllianceSetupActivity(tx, allianceId);
            }

            // Actor snapshot, resolved from the database inside this same
            // transaction (never trusted from the caller/session claims) —
            // matches MemberImport's own actor-resolution pattern.
            const actor = await tx.user.findUnique({
                where: { id: auth.user.id },
                select: { email: true, displayName: true },
            });
            if (!actor) {
                throw new Error("Acting user not found");
            }

            // Honest, not optimistic: only a fully clean DELETED/REVERTED
            // set earns the plain ROLLED_BACK outcome. Anything retained or
            // skipped — including a conflicted RESTORED row left untouched
            // — means the import's effects aren't completely gone.
            const outcome =
                retainedActiveCount + archivedPreservingHistoryCount + retainedArchivedCount + skippedConflictCount >
                0
                    ? MemberImportRollbackOutcome.ROLLED_BACK_WITH_RETAINED_MEMBERS
                    : MemberImportRollbackOutcome.ROLLED_BACK;

            await tx.memberImportRollback.create({
                data: {
                    memberImportId: memberImport.id,
                    allianceId,
                    actorUserId: auth.user.id,
                    actorEmailSnapshot: actor.email,
                    actorDisplayNameSnapshot: actor.displayName,
                    outcome,
                    deletedCount,
                    revertedCount,
                    retainedActiveCount,
                    archivedPreservingHistoryCount,
                    retainedArchivedCount,
                    skippedConflictCount,
                    results: { create: resultRows },
                },
            });

            return {
                outcome,
                deletedCount,
                revertedCount,
                retainedActiveCount,
                archivedPreservingHistoryCount,
                retainedArchivedCount,
                skippedConflictCount,
            };
        });

        revalidateAllianceData({
            allianceId,
            domains: ["members", "setup", "dashboard", "reports", "member-imports"],
        });
        return { success: true, ...summary };
    } catch (error) {
        if (error instanceof RollbackValidationError) {
            return { success: false, error: error.message };
        }
        throw error;
    }
}
