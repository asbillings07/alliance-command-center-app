"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { getMemberCapacityError } from "@/app/src/lib/memberCapacity";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";

export type BulkArchiveResult =
    | { success: true; archivedCount: number; skippedCount: number }
    | { success: false; error: string };

export type BulkRestoreResult =
    | { success: true; restoredCount: number; skippedCount: number }
    | { success: false; error: string };

function parseMemberIds(formData: FormData): string[] {
    return formData
        .getAll("memberId")
        .filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

/**
 * Bulk-archives every selected member that is still active.
 *
 * Selection can go stale between page load and submit (someone else already
 * archived a member in the meantime). That's treated as a no-op for that
 * member, not an error — it's reported back as `skippedCount` so the caller
 * can show an honest summary ("Archived 8 members. 2 were already archived
 * and were skipped.").
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
        // Scoped by both id and allianceId — a stale or tampered id from
        // another alliance simply won't match and is silently excluded,
        // same tenant-isolation posture as the single-member action.
        const members = await tx.allianceMember.findMany({
            where: { id: { in: memberIds }, allianceId },
            select: { id: true, archivedAt: true },
        });
        const stillActiveIds = members.filter((m) => !m.archivedAt).map((m) => m.id);

        if (stillActiveIds.length > 0) {
            await tx.allianceMember.updateMany({
                where: { id: { in: stillActiveIds } },
                data: { archivedAt: new Date() },
            });
            await touchAllianceSetupActivity(tx, allianceId);
        }

        return {
            archivedCount: stillActiveIds.length,
            skippedCount: memberIds.length - stillActiveIds.length,
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

                const capacityError = getMemberCapacityError(
                    activeMembersCount,
                    stillArchivedIds.length,
                    "restore"
                );
                if (capacityError) {
                    throw new Error(capacityError);
                }

                if (stillArchivedIds.length > 0) {
                    await tx.allianceMember.updateMany({
                        where: { id: { in: stillArchivedIds } },
                        data: { archivedAt: null },
                    });
                    await touchAllianceSetupActivity(tx, allianceId);
                }

                return {
                    restoredCount: stillArchivedIds.length,
                    skippedCount: memberIds.length - stillArchivedIds.length,
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
