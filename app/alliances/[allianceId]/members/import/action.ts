"use server";

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { withAllianceMemberCapacityLock } from "@/app/src/lib/allianceMemberLock";
import { revalidatePath } from "next/cache";

export type RosterEntry = {
    playerName: string;
    thp?: number;
    role?: string;
    restore?: boolean;
    selected?: boolean;
};

export type ImportResult = {
    created: number;
    restored: number;
    skippedExisting: number;
    skippedDuplicates: number;
    skippedEmptyNames: number;
    skippedUnselected: number;
    errors: string[];
};

export async function importMembers(
    allianceId: string,
    entries: RosterEntry[]
): Promise<ImportResult> {
    const auth = await requireAllianceAccess({ allianceId });

    if (!auth.permissions.canImportMembers) {
        return {
            created: 0,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames: 0,
            skippedUnselected: 0,
            errors: ["You don't have permission to import members"],
        };
    }

    if (entries.length === 0) {
        return {
            created: 0,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames: 0,
            skippedUnselected: 0,
            errors: ["No entries to import"],
        };
    }

    // Abuse protection ceiling for row count (separate from the 100-active-member domain capacity)
    if (entries.length > 2000) {
        return {
            created: 0,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames: 0,
            skippedUnselected: 0,
            errors: ["File exceeds maximum technical ceiling of 2,000 entries"],
        };
    }

    // Validate player names - filter out empty/whitespace-only entries
    let skippedEmptyNames = 0;
    const validatedEntries: RosterEntry[] = [];
    for (const entry of entries) {
        const trimmedName = entry.playerName.trim();
        if (!trimmedName) {
            skippedEmptyNames++;
        } else {
            validatedEntries.push({ ...entry, playerName: trimmedName });
        }
    }

    if (validatedEntries.length === 0) {
        return {
            created: 0,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames,
            skippedUnselected: 0,
            errors: skippedEmptyNames > 0
                ? ["All entries have empty player names"]
                : ["No valid entries to import"],
        };
    }

    try {
        // Pre-classify entries against database to calculate membersToAdd for capacity locking
        const existingMembers = await prisma.allianceMember.findMany({
            where: { allianceId },
            select: { id: true, playerName: true, archivedAt: true },
        });

        const activeNamesNormalized = new Set<string>();
        const archivedMembersNormalized = new Map<string, { id: string; playerName: string }>();

        for (const m of existingMembers) {
            const norm = normalizeName(m.playerName);
            if (m.archivedAt) {
                archivedMembersNormalized.set(norm, { id: m.id, playerName: m.playerName });
            } else {
                activeNamesNormalized.add(norm);
            }
        }

        const preCreate: RosterEntry[] = [];
        const preRestore: { id: string; entry: RosterEntry }[] = [];
        const seenInImport = new Set<string>();

        for (const entry of validatedEntries) {
            const normalized = normalizeName(entry.playerName);
            if (activeNamesNormalized.has(normalized)) {
                // Already active
            } else if (seenInImport.has(normalized)) {
                // Duplicate in file
            } else if (archivedMembersNormalized.has(normalized)) {
                seenInImport.add(normalized);
                const archivedInfo = archivedMembersNormalized.get(normalized)!;
                if (entry.selected !== false && entry.restore) {
                    preRestore.push({ id: archivedInfo.id, entry });
                }
            } else {
                seenInImport.add(normalized);
                if (entry.selected !== false) {
                    preCreate.push(entry);
                }
            }
        }

        const membersToAdd = preCreate.length + preRestore.length;

        const result = await withAllianceMemberCapacityLock(
            allianceId,
            membersToAdd,
            async (tx, activeMembersCount) => {
                // Re-fetch existing alliance members inside locked transaction
                const existingInTx = await tx.allianceMember.findMany({
                    where: { allianceId },
                    select: { id: true, playerName: true, archivedAt: true },
                });

                const activeInTx = new Set<string>();
                const archivedInTx = new Map<string, { id: string; playerName: string }>();

                for (const m of existingInTx) {
                    const norm = normalizeName(m.playerName);
                    if (m.archivedAt) {
                        archivedInTx.set(norm, { id: m.id, playerName: m.playerName });
                    } else {
                        activeInTx.add(norm);
                    }
                }

                const toCreate: RosterEntry[] = [];
                const toRestore: { id: string; entry: RosterEntry }[] = [];
                const seenInTx = new Set<string>();
                let skippedExisting = 0;
                let skippedDuplicates = 0;
                let skippedUnselected = 0;

                for (const entry of validatedEntries) {
                    const normalized = normalizeName(entry.playerName);

                    if (activeInTx.has(normalized)) {
                        skippedExisting++;
                    } else if (seenInTx.has(normalized)) {
                        skippedDuplicates++;
                    } else if (archivedInTx.has(normalized)) {
                        seenInTx.add(normalized);
                        const archivedInfo = archivedInTx.get(normalized)!;
                        if (entry.selected === false) {
                            skippedUnselected++;
                        } else if (entry.restore) {
                            toRestore.push({ id: archivedInfo.id, entry });
                        } else {
                            skippedExisting++;
                        }
                    } else {
                        seenInTx.add(normalized);
                        if (entry.selected === false) {
                            skippedUnselected++;
                        } else {
                            toCreate.push(entry);
                        }
                    }
                }

                const finalMembersToAdd = toCreate.length + toRestore.length;
                if (activeMembersCount + finalMembersToAdd > 100) {
                    const available = Math.max(0, 100 - activeMembersCount);
                    const overflow = (activeMembersCount + finalMembersToAdd) - 100;
                    throw new Error(
                        `Your alliance has ${activeMembersCount} active members, so you can add ${available} more. You currently have ${finalMembersToAdd} members selected (${toCreate.length} new, ${toRestore.length} restored). Deselect ${overflow} member${overflow === 1 ? "" : "s"} to continue.`
                    );
                }

                let createdCount = 0;
                if (toCreate.length > 0) {
                    const res = await tx.allianceMember.createMany({
                        data: toCreate.map((e) => ({
                            allianceId,
                            playerName: e.playerName.trim(),
                            thp: e.thp ?? null,
                            role: e.role?.trim() ?? null,
                        })),
                        skipDuplicates: true,
                    });
                    createdCount = res.count;
                }

                let restoredCount = 0;
                for (const item of toRestore) {
                    await tx.allianceMember.update({
                        where: { id: item.id },
                        data: {
                            archivedAt: null,
                            thp: item.entry.thp ?? undefined,
                            role: item.entry.role?.trim() ?? undefined,
                        },
                    });
                    restoredCount++;
                }

                return {
                    created: createdCount,
                    restored: restoredCount,
                    skippedExisting,
                    skippedDuplicates,
                    skippedEmptyNames,
                    skippedUnselected,
                    errors: [],
                };
            }
        );

        revalidatePath(`/alliances/${allianceId}/members`);

        return result;
    } catch (error) {
        console.error("Error importing alliance members:", error);
        const errorMessage =
            error instanceof Error && (error.message.includes("Your alliance has") || error.message.includes("active members"))
                ? error.message
                : "Failed to create members. Please try again.";
        return {
            created: 0,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames,
            skippedUnselected: 0,
            errors: [errorMessage],
        };
    }
}
