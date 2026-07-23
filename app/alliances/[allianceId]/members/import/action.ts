"use server";

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
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
    const validatedEntries = entries.filter((entry) => {
        const trimmedName = entry.playerName.trim();
        if (!trimmedName) {
            skippedEmptyNames++;
            return false;
        }
        return true;
    });

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
        const result = await prisma.$transaction(async (tx) => {
            // Concurrency protection: acquire pessimistic row lock on the Alliance record
            // to serialize concurrent roster imports for this specific alliance.
            await tx.$executeRaw`SELECT id FROM "Alliance" WHERE id = ${allianceId} FOR UPDATE`;

            // Fetch existing alliance members inside the locked transaction
            const existingMembers = await tx.allianceMember.findMany({
                where: { allianceId },
                select: { id: true, playerName: true, archivedAt: true },
            });

            const activeMembersCount = existingMembers.filter((m) => !m.archivedAt).length;

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

            const toCreate: RosterEntry[] = [];
            const toRestore: { id: string; entry: RosterEntry }[] = [];
            const seenInImport = new Set<string>();
            let skippedExisting = 0;
            let skippedDuplicates = 0;
            let skippedUnselected = 0;

            for (const entry of validatedEntries) {
                const normalized = normalizeName(entry.playerName);

                if (activeNamesNormalized.has(normalized)) {
                    skippedExisting++;
                } else if (seenInImport.has(normalized)) {
                    skippedDuplicates++;
                } else if (archivedMembersNormalized.has(normalized)) {
                    seenInImport.add(normalized);
                    const archivedInfo = archivedMembersNormalized.get(normalized)!;
                    if (entry.selected === false) {
                        skippedUnselected++;
                    } else if (entry.restore) {
                        toRestore.push({ id: archivedInfo.id, entry });
                    } else {
                        skippedExisting++;
                    }
                } else {
                    seenInImport.add(normalized);
                    if (entry.selected === false) {
                        skippedUnselected++;
                    } else {
                        toCreate.push(entry);
                    }
                }
            }

            const membersToAdd = toCreate.length + toRestore.length;

            if (membersToAdd === 0) {
                return {
                    created: 0,
                    restored: 0,
                    skippedExisting,
                    skippedDuplicates,
                    skippedEmptyNames,
                    skippedUnselected,
                    errors: [],
                };
            }

            // Capacity check: domain rule is <= 100 active members
            if (activeMembersCount + membersToAdd > 100) {
                const available = Math.max(0, 100 - activeMembersCount);
                const overflow = (activeMembersCount + membersToAdd) - 100;
                throw new Error(
                    `Your alliance has ${activeMembersCount} active members, so you can add ${available} more. You currently have ${membersToAdd} members selected (${toCreate.length} new, ${toRestore.length} restored). Deselect ${overflow} member${overflow === 1 ? "" : "s"} to continue.`
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
        });

        revalidatePath(`/alliances/${allianceId}/members`);

        return result;
    } catch (error) {
        console.error("Error importing alliance members:", error);
        const errorMessage =
            error instanceof Error && error.message.includes("Your alliance has")
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
