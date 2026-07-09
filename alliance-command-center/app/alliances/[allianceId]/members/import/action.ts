"use server";

import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { revalidatePath } from "next/cache";

export type RosterEntry = {
    playerName: string;
    thp?: number;
    role?: string;
};

export type ImportResult = {
    created: number;
    skippedExisting: number;
    skippedDuplicates: number;
    errors: string[];
};

export async function importMembers(
    allianceId: string,
    entries: RosterEntry[]
): Promise<ImportResult> {
    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

    if (entries.length === 0) {
        return { created: 0, skippedExisting: 0, skippedDuplicates: 0, errors: ["No entries to import"] };
    }

    if (entries.length > 100) {
        return { created: 0, skippedExisting: 0, skippedDuplicates: 0, errors: ["Cannot import more than 100 members at once"] };
    }

    // Validate player names - filter out empty/whitespace-only entries
    const invalidEntries: string[] = [];
    const validatedEntries = entries.filter((entry) => {
        const trimmedName = entry.playerName.trim();
        if (!trimmedName) {
            invalidEntries.push("Empty player name");
            return false;
        }
        return true;
    });

    if (validatedEntries.length === 0) {
        return { 
            created: 0, 
            skippedExisting: 0, 
            skippedDuplicates: 0, 
            errors: invalidEntries.length > 0 
                ? [`All entries have invalid player names (${invalidEntries.length} empty)`] 
                : ["No valid entries to import"] 
        };
    }

    // Get existing members for this alliance
    const existingMembers = await prisma.member.findMany({
        where: { allianceId },
        select: { playerName: true },
    });

    // Build a set of normalized existing names for fast lookup
    const existingNamesNormalized = new Set(
        existingMembers.map((m) => normalizeName(m.playerName))
    );

    // Separate new entries from existing, tracking all skip reasons
    const newEntries: RosterEntry[] = [];
    const seenInImport = new Set<string>();
    let skippedExisting = 0;
    let skippedDuplicates = 0;

    for (const entry of validatedEntries) {
        const normalized = normalizeName(entry.playerName);
        
        if (existingNamesNormalized.has(normalized)) {
            skippedExisting++;
        } else if (seenInImport.has(normalized)) {
            skippedDuplicates++;
        } else {
            seenInImport.add(normalized);
            newEntries.push(entry);
        }
    }

    if (newEntries.length === 0) {
        return {
            created: 0,
            skippedExisting,
            skippedDuplicates,
            errors: [],
        };
    }

    // Create all new members in a single transaction
    const errors: string[] = [];

    try {
        await prisma.$transaction(async (tx) => {
            for (const entry of newEntries) {
                await tx.member.create({
                    data: {
                        allianceId,
                        playerName: entry.playerName.trim(),
                        thp: entry.thp ?? null,
                        role: entry.role?.trim() ?? null,
                    },
                });
            }
        });
    } catch (error) {
        console.error("Error importing members:", error);
        errors.push("Failed to create members. Please try again.");
        return {
            created: 0,
            skippedExisting,
            skippedDuplicates,
            errors,
        };
    }

    revalidatePath(`/alliances/${allianceId}/members`);

    return {
        created: newEntries.length,
        skippedExisting,
        skippedDuplicates,
        errors,
    };
}
