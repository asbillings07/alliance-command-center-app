"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import {
    MemberImportRollbackOutcome,
    MemberImportRollbackResultResolution,
} from "@/app/generated/prisma/enums";
import { computeImportRollbackPreview } from "../rollbackPreview";

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
 * Commits the undo of a single completed roster import (#277 PR 3).
 *
 * Everything — re-deriving the preview, cross-checking the caller's
 * resolutions against it, and executing the resulting mutations — happens
 * inside one `withAllianceMemberLock` transaction. The page's earlier
 * preview is only ever a suggestion to the user; this action never trusts
 * it. It recomputes `computeImportRollbackPreview` fresh here and aborts the
 * whole transaction if that fresh preview now requires a choice the
 * submission doesn't have (an in-between edit introduced a new conflict) —
 * see that module's own doc comment for why one shared implementation
 * matters here.
 */
export async function rollbackImport(formData: FormData): Promise<RollbackImportResult> {
    const allianceId = formData.get("allianceId");
    const importId = formData.get("importId");
    if (
        typeof allianceId !== "string" ||
        allianceId.trim() === "" ||
        typeof importId !== "string" ||
        importId.trim() === ""
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

            const preview = await computeImportRollbackPreview(tx, memberImport, memberImport.changes);

            for (const item of preview.items) {
                if (item.requiresResolution && !resolutions.has(item.changeId)) {
                    throw new RollbackValidationError(
                        "This import's state changed since you loaded this page. Review the updated preview and try again."
                    );
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
                        await tx.allianceMember.update({
                            where: { id: change.allianceMemberId! },
                            data: { archivedAt: new Date() },
                        });
                        anyMemberMutated = true;
                    }
                } else {
                    switch (item.defaultResolution) {
                        case "DELETED":
                            resolution = MemberImportRollbackResultResolution.DELETED;
                            deletedCount++;
                            await tx.allianceMember.delete({ where: { id: change.allianceMemberId! } });
                            anyMemberMutated = true;
                            break;
                        case "REVERTED_TO_PRE_IMPORT_STATE":
                            resolution = MemberImportRollbackResultResolution.REVERTED_TO_PRE_IMPORT_STATE;
                            revertedCount++;
                            await tx.allianceMember.update({
                                where: { id: change.allianceMemberId! },
                                data: {
                                    archivedAt: change.archivedAtBefore,
                                    thp: change.thpBefore,
                                    role: change.roleBefore,
                                },
                            });
                            anyMemberMutated = true;
                            break;
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
