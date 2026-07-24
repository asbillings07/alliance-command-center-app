"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { parseStrictInteger } from "@/app/src/lib/numberParser";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";

export type RosterEntry = {
    playerName: string;
    thp?: string;
    role?: string;
    restore?: boolean;
    selected?: boolean;
};

type ValidatedRosterEntry = {
    playerName: string;
    thp?: string;
    parsedThp?: number;
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
    const validatedEntries: ValidatedRosterEntry[] = [];
    for (const entry of entries) {
        const trimmedName = entry.playerName.trim();
        if (!trimmedName) {
            skippedEmptyNames++;
        } else {
            validatedEntries.push({
                playerName: trimmedName,
                thp: entry.thp,
                role: entry.role,
                restore: entry.restore,
                selected: entry.selected,
            });
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

    // Validate selected THP values with parseStrictInteger and THP domain rule (non-negative)
    for (const entry of validatedEntries) {
        if (entry.selected !== false && entry.thp !== undefined && entry.thp !== null) {
            if (typeof entry.thp !== "string") {
                return {
                    created: 0,
                    restored: 0,
                    skippedExisting: 0,
                    skippedDuplicates: 0,
                    skippedEmptyNames,
                    skippedUnselected: 0,
                    errors: [`Invalid THP value for player "${entry.playerName}": THP must be provided as a raw string`],
                };
            }
            const rawThpStr = entry.thp.trim();
            if (rawThpStr !== "") {
                const parsed = parseStrictInteger(rawThpStr);
                if (!parsed.success) {
                    return {
                        created: 0,
                        restored: 0,
                        skippedExisting: 0,
                        skippedDuplicates: 0,
                        skippedEmptyNames,
                        skippedUnselected: 0,
                        errors: [`Invalid THP value "${rawThpStr}" for player "${entry.playerName}": ${parsed.error}`],
                    };
                }
                if (parsed.value < 0) {
                    return {
                        created: 0,
                        restored: 0,
                        skippedExisting: 0,
                        skippedDuplicates: 0,
                        skippedEmptyNames,
                        skippedUnselected: 0,
                        errors: [`Total Hero Power cannot be negative for player "${entry.playerName}" (${parsed.value})`],
                    };
                }
                entry.parsedThp = parsed.value;
            }
        }
    }

    try {
        const result = await withAllianceMemberLock(
            allianceId,
            async (tx, activeMembersCount) => {
                // Fetch existing alliance members inside locked transaction
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

                const toCreate: ValidatedRosterEntry[] = [];
                const toRestore: { id: string; entry: ValidatedRosterEntry }[] = [];
                const seenInTx = new Set<string>();
                let skippedExisting = 0;
                let skippedDuplicates = 0;
                let skippedUnselected = 0;

                for (const entry of validatedEntries) {
                    const normalized = normalizeName(entry.playerName);

                    // Track first occurrence before database classification so later normalized occurrences are always duplicates
                    if (seenInTx.has(normalized)) {
                        skippedDuplicates++;
                    } else {
                        seenInTx.add(normalized);
                        if (activeInTx.has(normalized)) {
                            skippedExisting++;
                        } else if (archivedInTx.has(normalized)) {
                            const archivedInfo = archivedInTx.get(normalized)!;
                            if (entry.selected === false) {
                                skippedUnselected++;
                            } else if (entry.restore) {
                                toRestore.push({ id: archivedInfo.id, entry });
                            } else {
                                skippedExisting++;
                            }
                        } else {
                            if (entry.selected === false) {
                                skippedUnselected++;
                            } else {
                                toCreate.push(entry);
                            }
                        }
                    }
                }

                const finalMembersToAdd = toCreate.length + toRestore.length;

                // Domain active roster capacity check (<= 100)
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
                            thp: e.parsedThp ?? null,
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
                            thp: item.entry.parsedThp ?? undefined,
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

        revalidateAllianceData({
            allianceId,
            domains: ["members", "setup", "dashboard"],
        });

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
