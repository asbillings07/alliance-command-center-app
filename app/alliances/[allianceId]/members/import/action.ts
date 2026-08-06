"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { MAX_ACTIVE_ALLIANCE_MEMBERS, getAvailableMemberCapacity } from "@/app/src/lib/memberCapacity";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import { validateImportProvenance, validateStructuralEntries, validateThpValue } from "./importValidation";
import type { ImportProvenance } from "./importValidation";

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
    // type checks must run before touching any property or calling
    // `.trim()`: a caller that bypasses the ImportProvenance TypeScript type
    // (e.g. calling this server action directly) could send an entirely
    // missing/null/non-object third argument, and `provenance.fileName` on
    // that throws outside the try/catch below rather than failing closed
    // with a normal error result.
    const provenanceResult = validateImportProvenance(provenance);
    if (!provenanceResult.success) {
        return failResult([provenanceResult.error]);
    }
    const { fileName, sourceSheetName } = provenanceResult;

    const structuralResult = validateStructuralEntries(entries);
    if (!structuralResult.success) {
        return failResult(structuralResult.errors, structuralResult.skippedEmptyNames);
    }
    const { skippedEmptyNames } = structuralResult;
    const validatedEntries: ValidatedRosterEntry[] = structuralResult.validatedEntries;

    // Validate selected THP values with parseStrictInteger and THP domain rule (non-negative)
    for (const entry of validatedEntries) {
        if (entry.selected !== false) {
            const thpResult = validateThpValue(entry.thp, entry.playerName);
            if (!thpResult.success) {
                return failResult([thpResult.error], skippedEmptyNames);
            }
            entry.parsedThp = thpResult.parsedThp;
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

                // Domain active roster capacity check. Not delegated to the
                // shared getBulkMemberCapacityError() message — this commit can
                // mix new members with restores in one go, and the message
                // below breaks that down (`toCreate.length` new vs
                // `toRestore.length` restored), which the generic single-verb
                // helper doesn't model.
                if (activeMembersCount + finalMembersToAdd > MAX_ACTIVE_ALLIANCE_MEMBERS) {
                    const available = getAvailableMemberCapacity(activeMembersCount);
                    const overflow = (activeMembersCount + finalMembersToAdd) - MAX_ACTIVE_ALLIANCE_MEMBERS;
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
