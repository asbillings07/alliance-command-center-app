"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { parseStrictInteger } from "@/app/src/lib/numberParser";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { MAX_PHYSICAL_ROWS_PER_SHEET } from "@/app/src/lib/workbookParser";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";

export type RosterEntry = {
    playerName: string;
    thp?: string;
    role?: string;
    restore?: boolean;
    selected?: boolean;
    // 1-based position in the source worksheet (already computed client-side
    // as ParsedMember.sourceRow). Client-supplied display metadata, not
    // authenticated proof — validated below before it's trusted for history.
    sourceRow: number;
};

type ValidatedRosterEntry = {
    playerName: string;
    thp?: string;
    parsedThp?: number;
    role?: string;
    restore?: boolean;
    selected?: boolean;
    sourceRow: number;
};

// Where a restored member's pre-import scalar state is captured from, so the
// change row can record a real "before" snapshot without a second read.
type ArchivedMemberSnapshot = {
    id: string;
    playerName: string;
    thp: number | null;
    role: string | null;
    archivedAt: Date | null;
};

// Provenance metadata about the uploaded file. Like sourceRow, this is
// client-supplied display metadata, not authenticated proof — validated
// below before it's trusted for history.
export type ImportProvenance = {
    fileName: string;
    sourceSheetName: string;
};

export type ImportResult = {
    created: number;
    restored: number;
    skippedExisting: number;
    skippedDuplicates: number;
    skippedEmptyNames: number;
    skippedUnselected: number;
    errors: string[];
    // The MemberImport row created for this operation, or null when nothing
    // entered history (permission/validation/capacity failure, or a
    // zero-net-effect commit where every row was skipped).
    memberImportId: string | null;
};

const MAX_NAME_METADATA_LENGTH = 255;

function failResult(errors: string[], skippedEmptyNames = 0): ImportResult {
    return {
        created: 0,
        restored: 0,
        skippedExisting: 0,
        skippedDuplicates: 0,
        skippedEmptyNames,
        skippedUnselected: 0,
        errors,
        memberImportId: null,
    };
}

export async function importMembers(
    allianceId: string,
    entries: RosterEntry[],
    provenance: ImportProvenance
): Promise<ImportResult> {
    const auth = await requireAllianceAccess({ allianceId });

    if (!auth.permissions.canImportMembers) {
        return failResult(["You don't have permission to import members"]);
    }

    // Provenance metadata is client-supplied display metadata, not
    // authenticated proof — validate it explicitly before trusting it. The
    // type check must run before `.trim()`: a caller that bypasses the
    // ImportProvenance TypeScript type (e.g. calling this server action
    // directly) could send `null`/`undefined`/non-string values, and
    // `.trim()` on those throws outside the try/catch below rather than
    // failing closed with a normal error result.
    if (typeof provenance.fileName !== "string") {
        return failResult(["Missing or invalid file name"]);
    }
    if (typeof provenance.sourceSheetName !== "string") {
        return failResult(["Missing or invalid worksheet name"]);
    }
    const fileName = provenance.fileName.trim();
    const sourceSheetName = provenance.sourceSheetName.trim();
    if (fileName.length === 0 || fileName.length > MAX_NAME_METADATA_LENGTH) {
        return failResult(["Missing or invalid file name"]);
    }
    if (sourceSheetName.length === 0 || sourceSheetName.length > MAX_NAME_METADATA_LENGTH) {
        return failResult(["Missing or invalid worksheet name"]);
    }

    if (entries.length === 0) {
        return failResult(["No entries to import"]);
    }

    // Abuse protection ceiling for row count (separate from the 100-active-member domain capacity)
    if (entries.length > 2000) {
        return failResult(["File exceeds maximum technical ceiling of 2,000 entries"]);
    }

    // sourceRow must be a positive, safe integer within the parser's physical
    // row ceiling, and a source row cannot produce multiple affected changes
    // — enforced here by requiring every submitted sourceRow to be unique,
    // and backed at the DB by MemberImportChange's
    // @@unique([memberImportId, sourceRow]).
    const seenSourceRows = new Set<number>();
    for (const entry of entries) {
        if (
            !Number.isSafeInteger(entry.sourceRow) ||
            entry.sourceRow <= 0 ||
            entry.sourceRow > MAX_PHYSICAL_ROWS_PER_SHEET
        ) {
            return failResult([`Invalid source row for player "${entry.playerName}"`]);
        }
        if (seenSourceRows.has(entry.sourceRow)) {
            return failResult([`Duplicate source row ${entry.sourceRow} in submitted entries`]);
        }
        seenSourceRows.add(entry.sourceRow);
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
                sourceRow: entry.sourceRow,
            });
        }
    }

    if (validatedEntries.length === 0) {
        return failResult(
            skippedEmptyNames > 0
                ? ["All entries have empty player names"]
                : ["No valid entries to import"],
            skippedEmptyNames
        );
    }

    // Validate selected THP values with parseStrictInteger and THP domain rule (non-negative)
    for (const entry of validatedEntries) {
        if (entry.selected !== false && entry.thp !== undefined && entry.thp !== null) {
            if (typeof entry.thp !== "string") {
                return failResult(
                    [`Invalid THP value for player "${entry.playerName}": THP must be provided as a raw string`],
                    skippedEmptyNames
                );
            }
            const rawThpStr = entry.thp.trim();
            if (rawThpStr !== "") {
                const parsed = parseStrictInteger(rawThpStr);
                if (!parsed.success) {
                    return failResult(
                        [`Invalid THP value "${rawThpStr}" for player "${entry.playerName}": ${parsed.error}`],
                        skippedEmptyNames
                    );
                }
                if (parsed.value < 0) {
                    return failResult(
                        [`Total Hero Power cannot be negative for player "${entry.playerName}" (${parsed.value})`],
                        skippedEmptyNames
                    );
                }
                entry.parsedThp = parsed.value;
            }
        }
    }

    try {
        const result = await withAllianceMemberLock(
            allianceId,
            async (tx, activeMembersCount) => {
                // Fetch existing alliance members inside locked transaction.
                // thp/role/archivedAt are selected here (not re-read later) so
                // restore's "before" snapshot for history comes from this same
                // authoritative read.
                const existingInTx = await tx.allianceMember.findMany({
                    where: { allianceId },
                    select: { id: true, playerName: true, archivedAt: true, thp: true, role: true },
                });

                const activeInTx = new Set<string>();
                const archivedInTx = new Map<string, ArchivedMemberSnapshot>();

                for (const m of existingInTx) {
                    const norm = normalizeName(m.playerName);
                    if (m.archivedAt) {
                        archivedInTx.set(norm, {
                            id: m.id,
                            playerName: m.playerName,
                            thp: m.thp,
                            role: m.role,
                            archivedAt: m.archivedAt,
                        });
                    } else {
                        activeInTx.add(norm);
                    }
                }

                const toCreate: ValidatedRosterEntry[] = [];
                const toRestore: { before: ArchivedMemberSnapshot; entry: ValidatedRosterEntry }[] = [];
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
                                toRestore.push({ before: archivedInfo, entry });
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

                let createdRows: {
                    id: string;
                    playerName: string;
                    thp: number | null;
                    role: string | null;
                    archivedAt: Date | null;
                    discordName: string | null;
                    squadPower: number | null;
                    joinedAt: Date | null;
                    userId: string | null;
                    updatedAt: Date;
                }[] = [];
                if (toCreate.length > 0) {
                    createdRows = await tx.allianceMember.createManyAndReturn({
                        data: toCreate.map((e) => ({
                            allianceId,
                            playerName: e.playerName.trim(),
                            thp: e.parsedThp ?? null,
                            role: e.role?.trim() ?? null,
                        })),
                        skipDuplicates: true,
                    });
                }
                const createdCount = createdRows.length;

                // Fail closed on any short create: if createManyAndReturn
                // ever returns fewer rows than requested (e.g. an unexpected
                // skipDuplicates collision), the row-by-row name matching
                // below can only validate what *was* returned — it can't
                // detect a silently-missing row. Without this check the
                // import would commit with incomplete history and
                // undercounted createdCount. Roll back the whole transaction
                // instead.
                if (createdCount !== toCreate.length) {
                    throw new Error(
                        `Import provenance mismatch: expected to create ${toCreate.length} member(s) but only ${createdCount} were created`
                    );
                }

                // createManyAndReturn's result order is not guaranteed to
                // match input order — match each returned row back to its
                // source entry by normalized player name, never by zipping
                // the two arrays by index. Throw on any non-exact match so
                // the whole import rolls back rather than persisting
                // mismatched provenance.
                const toCreateByNormalizedName = new Map<string, ValidatedRosterEntry>();
                for (const e of toCreate) {
                    toCreateByNormalizedName.set(normalizeName(e.playerName), e);
                }
                const consumedCreateNames = new Set<string>();
                const matchedCreates: { row: (typeof createdRows)[number]; entry: ValidatedRosterEntry }[] = [];
                for (const row of createdRows) {
                    const norm = normalizeName(row.playerName);
                    const entry = toCreateByNormalizedName.get(norm);
                    if (!entry || consumedCreateNames.has(norm)) {
                        throw new Error(
                            `Import provenance mismatch: created member "${row.playerName}" did not match exactly one source entry`
                        );
                    }
                    consumedCreateNames.add(norm);
                    matchedCreates.push({ row, entry });
                }

                const restoredUpdates: {
                    before: ArchivedMemberSnapshot;
                    entry: ValidatedRosterEntry;
                    updated: {
                        id: string;
                        playerName: string;
                        thp: number | null;
                        role: string | null;
                        archivedAt: Date | null;
                        discordName: string | null;
                        squadPower: number | null;
                        joinedAt: Date | null;
                        userId: string | null;
                        updatedAt: Date;
                    };
                }[] = [];
                for (const item of toRestore) {
                    const updated = await tx.allianceMember.update({
                        where: { id: item.before.id },
                        data: {
                            archivedAt: null,
                            thp: item.entry.parsedThp ?? undefined,
                            role: item.entry.role?.trim() ?? undefined,
                        },
                    });
                    restoredUpdates.push({ before: item.before, entry: item.entry, updated });
                }
                const restoredCount = restoredUpdates.length;

                await touchAllianceSetupActivity(tx, allianceId);

                // History gate: only record provenance when the transaction
                // actually mutated at least one member. A zero-net-effect
                // commit (everything skipped) writes no history row at all.
                let memberImportId: string | null = null;
                if (createdCount + restoredCount >= 1) {
                    // Actor snapshot, resolved from the database inside this
                    // same transaction (never trusted from the caller/session
                    // claims) — matches AccessRequestTriageEvent's actor
                    // resolution pattern.
                    const actor = await tx.user.findUnique({
                        where: { id: auth.user.id },
                        select: { email: true, displayName: true },
                    });
                    if (!actor) {
                        throw new Error("Acting user not found");
                    }

                    const memberImport = await tx.memberImport.create({
                        data: {
                            allianceId,
                            actorUserId: auth.user.id,
                            actorEmailSnapshot: actor.email,
                            actorDisplayNameSnapshot: actor.displayName,
                            fileName,
                            sourceSheetName,
                            createdCount,
                            restoredCount,
                            skippedExistingCount: skippedExisting,
                            skippedDuplicateCount: skippedDuplicates,
                            skippedEmptyNameCount: skippedEmptyNames,
                            skippedUnselectedCount: skippedUnselected,
                            changes: {
                                create: [
                                    ...matchedCreates.map(({ row, entry }) => ({
                                        allianceMemberId: row.id,
                                        playerNameSnapshot: row.playerName,
                                        sourceRow: entry.sourceRow,
                                        changeType: MemberImportChangeType.CREATED,
                                        archivedAtBefore: null,
                                        archivedAtAfter: row.archivedAt,
                                        thpBefore: null,
                                        thpAfter: row.thp,
                                        roleBefore: null,
                                        roleAfter: row.role,
                                        discordNameAfter: row.discordName,
                                        squadPowerAfter: row.squadPower,
                                        joinedAtAfter: row.joinedAt,
                                        userIdAfter: row.userId,
                                        memberUpdatedAtAfter: row.updatedAt,
                                    })),
                                    ...restoredUpdates.map(({ before, entry, updated }) => ({
                                        allianceMemberId: updated.id,
                                        playerNameSnapshot: updated.playerName,
                                        sourceRow: entry.sourceRow,
                                        changeType: MemberImportChangeType.RESTORED,
                                        archivedAtBefore: before.archivedAt,
                                        archivedAtAfter: updated.archivedAt,
                                        thpBefore: before.thp,
                                        thpAfter: updated.thp,
                                        roleBefore: before.role,
                                        roleAfter: updated.role,
                                        discordNameAfter: updated.discordName,
                                        squadPowerAfter: updated.squadPower,
                                        joinedAtAfter: updated.joinedAt,
                                        userIdAfter: updated.userId,
                                        memberUpdatedAtAfter: updated.updatedAt,
                                    })),
                                ],
                            },
                        },
                        select: { id: true },
                    });
                    memberImportId = memberImport.id;
                }

                return {
                    created: createdCount,
                    restored: restoredCount,
                    skippedExisting,
                    skippedDuplicates,
                    skippedEmptyNames,
                    skippedUnselected,
                    errors: [],
                    memberImportId,
                };
            }
        );

        revalidateAllianceData({
            allianceId,
            domains: result.memberImportId
                ? ["members", "setup", "dashboard", "reports", "member-imports"]
                : ["members", "setup", "dashboard", "reports"],
        });

        return result;
    } catch (error) {
        console.error("Error importing alliance members:", error);
        const errorMessage =
            error instanceof Error && (error.message.includes("Your alliance has") || error.message.includes("active members"))
                ? error.message
                : "Failed to create members. Please try again.";
        return failResult([errorMessage], skippedEmptyNames);
    }
}
