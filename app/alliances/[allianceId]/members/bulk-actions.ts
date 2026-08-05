"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { getBulkMemberCapacityError } from "@/app/src/lib/memberCapacity";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";

export type BulkArchiveResult =
    | { success: true; archivedCount: number; skippedCount: number }
    | { success: false; error: string };

export type BulkRestoreResult =
    | { success: true; restoredCount: number; skippedCount: number }
    | { success: false; error: string };

/**
 * De-duplicated so a tampered request (or a future client bug) can't inflate
 * `skippedCount` or produce a confusing "N members selected" count when the
 * same id was submitted more than once.
 */
function parseMemberIds(formData: FormData): string[] {
    const ids = formData
        .getAll("memberId")
        .filter((value): value is string => typeof value === "string" && value.trim() !== "");
    return Array.from(new Set(ids));
}

/**
 * Bulk-archives every selected member that is still active.
 *
 * Selection can go stale between page load and submit (someone else already
 * archived a member in the meantime). That's treated as a no-op for that
 * member, not an error — it's reported back as `skippedCount` so the caller
 * can show an honest summary ("Archived 8 members. 2 were already archived
 * and were skipped.").
 *
 * The `archivedAt: null` condition lives in the `updateMany` `WHERE` clause
 * itself, not in an earlier read — a plain "read active ids, then write
 * those ids" would race: two concurrent bulk archives can both read the same
 * member as still-active before either commits, so the second would
 * overwrite `archivedAt`/`updatedAt` again and *also* misreport that member
 * as newly archived instead of skipped. Conditioning the update's `WHERE` on
 * `archivedAt: null` makes Postgres itself the source of truth for which
 * rows actually transitioned — the second transaction's `updateMany` simply
 * won't match a row the first one already archived, and `.count` reports
 * the real number of rows this call archived.
 */
export async function bulkArchiveMembers(formData: FormData): Promise<BulkArchiveResult> {
    const allianceId = formData.get("allianceId");
    if (typeof allianceId !== "string" || allianceId.trim() === "") {
        return { success: false, error: "Invalid request" };
    }

    const memberIds = parseMemberIds(formData);
    if (memberIds.length === 0) {
        return { success: false, error: "No members selected" };
    }

    const auth = await requireAllianceAccess({ allianceId });
    if (!auth.permissions.canManageMembers) {
        return { success: false, error: "You don't have permission to archive members" };
    }

    const { archivedCount, skippedCount } = await prisma.$transaction(async (tx) => {
        // Scoped by id, allianceId, AND archivedAt: null — a stale/tampered
        // id from another alliance, an already-archived member, or a
        // duplicate id all simply fail to match and are excluded, same
        // tenant-isolation posture as the single-member action.
        const result = await tx.allianceMember.updateMany({
            where: { id: { in: memberIds }, allianceId, archivedAt: null },
            data: { archivedAt: new Date() },
        });

        if (result.count > 0) {
            await touchAllianceSetupActivity(tx, allianceId);
        }

        return {
            archivedCount: result.count,
            skippedCount: memberIds.length - result.count,
        };
    });

    revalidateAllianceData({ allianceId, domains: ["members", "reports"] });
    return { success: true, archivedCount, skippedCount };
}

/**
 * Bulk-restores every selected member that is still archived, subject to the
 * active-member capacity cap.
 *
 * The capacity check runs *inside* the alliance row lock and is evaluated
 * against only the still-archived subset of the selection (a member someone
 * else already restored needs no new capacity and shouldn't count against
 * it). If that subset would exceed the cap, the whole restore is rejected
 * atomically — zero members are restored, never an arbitrary partial subset.
 *
 * `withAllianceMemberLock`'s exclusive `Alliance` row lock already
 * serializes this against every other capacity-checked mutation for the
 * same alliance (single restore, bulk restore, add member, invite
 * collaborator all take the same lock), so the read used for the capacity
 * math can't go stale before the write below runs. The write's `WHERE` is
 * still conditioned on `archivedAt: { not: null }` (matching the archive
 * path's defense-in-depth) so `restoredCount` always reflects rows this call
 * actually changed, not just the pre-write read.
 */
export async function bulkRestoreMembers(formData: FormData): Promise<BulkRestoreResult> {
    const allianceId = formData.get("allianceId");
    if (typeof allianceId !== "string" || allianceId.trim() === "") {
        return { success: false, error: "Invalid request" };
    }

    const memberIds = parseMemberIds(formData);
    if (memberIds.length === 0) {
        return { success: false, error: "No members selected" };
    }

    const auth = await requireAllianceAccess({ allianceId });
    if (!auth.permissions.canManageMembers) {
        return { success: false, error: "You don't have permission to restore members" };
    }

    try {
        const { restoredCount, skippedCount } = await withAllianceMemberLock(
            allianceId,
            async (tx, activeMembersCount) => {
                const members = await tx.allianceMember.findMany({
                    where: { id: { in: memberIds }, allianceId },
                    select: { id: true, archivedAt: true },
                });
                const stillArchivedIds = members.filter((m) => m.archivedAt).map((m) => m.id);

                const capacityError = getBulkMemberCapacityError(
                    activeMembersCount,
                    stillArchivedIds.length,
                    "restore"
                );
                if (capacityError) {
                    throw new Error(capacityError);
                }

                let restoredCount = 0;
                if (stillArchivedIds.length > 0) {
                    const result = await tx.allianceMember.updateMany({
                        where: { id: { in: stillArchivedIds }, archivedAt: { not: null } },
                        data: { archivedAt: null },
                    });
                    restoredCount = result.count;
                    if (restoredCount > 0) {
                        await touchAllianceSetupActivity(tx, allianceId);
                    }
                }

                return {
                    restoredCount,
                    skippedCount: memberIds.length - restoredCount,
                };
            }
        );

        revalidateAllianceData({ allianceId, domains: ["members", "reports"] });
        return { success: true, restoredCount, skippedCount };
    } catch (error) {
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        throw error;
    }
}
