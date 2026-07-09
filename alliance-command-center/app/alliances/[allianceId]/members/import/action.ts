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
    skipped: number;
    errors: string[];
};

export async function importMembers(
    allianceId: string,
    entries: RosterEntry[]
): Promise<ImportResult> {
    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

    if (entries.length === 0) {
        return { created: 0, skipped: 0, errors: ["No entries to import"] };
    }

    if (entries.length > 100) {
        return { created: 0, skipped: 0, errors: ["Cannot import more than 100 members at once"] };
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

    // Separate new entries from existing
    const newEntries: RosterEntry[] = [];
    const skippedCount = { count: 0 };

    for (const entry of entries) {
        const normalized = normalizeName(entry.playerName);
        if (existingNamesNormalized.has(normalized)) {
            skippedCount.count++;
        } else {
            // Check for duplicates within the import itself
            if (!newEntries.some((e) => normalizeName(e.playerName) === normalized)) {
                newEntries.push(entry);
            }
        }
    }

    if (newEntries.length === 0) {
        return {
            created: 0,
            skipped: skippedCount.count,
            errors: [],
        };
    }

    // Create all new members in a single transaction
    const errors: string[] = [];
    let createdCount = 0;

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
                createdCount++;
            }
        });
    } catch (error) {
        console.error("Error importing members:", error);
        errors.push("Failed to create some members. Please try again.");
    }

    revalidatePath(`/alliances/${allianceId}/members`);

    return {
        created: createdCount,
        skipped: skippedCount.count,
        errors,
    };
}
