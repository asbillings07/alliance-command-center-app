"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { MAX_ACTIVE_ALLIANCE_MEMBERS, getAvailableMemberCapacity } from "@/app/src/lib/memberCapacity";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { MemberImportChangeType, MemberImportMode } from "@/app/generated/prisma/enums";
import { validateImportProvenance, validateStructuralEntries, validateThpValue } from "./importValidation";
import type { ImportProvenance } from "./importValidation";
import { classifyHistoricalRosterRow } from "./historicalClassification";
import type { HistoricalFinalStatus } from "./historicalClassification";
import { computeHistoricalImportFingerprint } from "./historicalImportFingerprint";
import type { HistoricalFingerprintRow } from "./historicalImportFingerprint";

/**
 * #277 PR 4 (#282): "Historical roster" import mode. Reuses the current
 * roster import's provenance/capacity/audit machinery, but a leader
 * explicitly assigns every selected row's final status (Active/Archived)
 * instead of the tool inferring it from a restore checkbox — see
 * historicalClassification.ts's decision table for the full outcome
 * matrix.
 *
 * The most important structural difference from ../action.ts's
 * `importMembers()` is the stale-preview fingerprint. The client computes
 * `expectedFingerprint` from exactly the classification it rendered (using
 * the same `classifyHistoricalRosterRow` this file uses); this action
 * recomputes that same fingerprint from a fresh read taken *inside*
 * `withAllianceMemberLock` and aborts the entire import — no partial
 * commit, no silent reclassification — on any mismatch. This matters
 * specifically because historical mode can *change a member's lifecycle*
 * (restore an archived member), unlike a plain field edit: without this
 * check, a member another leader archived after this leader loaded the
 * page could be silently restored because the stale preview still said
 * "existing active, preserve active" one moment and the live data says
 * "existing archived" the next — reclassifying that row as RESTORE instead
 * of rejecting the whole submission.
 */

export type HistoricalRosterEntry = {
    playerName: string;
    thp?: string;
    role?: string;
    /**
     * The leader's explicit request for this row. "unassigned" is only
     * valid on an *unselected* row (the client blocks confirmation for any
     * selected row that's still unassigned) — a selected "unassigned" row
     * reaching this action fails the whole import; see
     * `UNASSIGNED_SELECTED_ROW_ERROR` below.
     */
    finalStatus: HistoricalFinalStatus;
    selected?: boolean;
    sourceRow: number;
};

type ValidatedHistoricalEntry = {
    playerName: string;
    thp?: string;
    parsedThp?: number;
    role?: string;
    finalStatus: HistoricalFinalStatus;
    selected?: boolean;
    sourceRow: number;
};

// Snapshot of an existing member's pre-import scalar state, read once inside
// the lock. Used both to classify the row and — for a RESTORE outcome — as
// the change row's "before" state.
type ExistingMemberSnapshot = {
    id: string;
    playerName: string;
    thp: number | null;
    role: string | null;
    archivedAt: Date | null;
};

export type HistoricalImportResult = {
    createdActive: number;
    createdArchived: number;
    restored: number;
    skippedExisting: number;
    skippedDuplicates: number;
    skippedEmptyNames: number;
    skippedUnselected: number;
    skippedLifecycleConflict: number;
    errors: string[];
    memberImportId: string | null;
};

function failResult(errors: string[], skippedEmptyNames = 0): HistoricalImportResult {
    return {
        createdActive: 0,
        createdArchived: 0,
        restored: 0,
        skippedExisting: 0,
        skippedDuplicates: 0,
        skippedEmptyNames,
        skippedUnselected: 0,
        skippedLifecycleConflict: 0,
        errors,
        memberImportId: null,
    };
}

const STALE_PREVIEW_ERROR =
    "Your preview is out of date because member data changed since you loaded this page. " +
    "Refresh and review the import again before submitting.";

export async function importHistoricalRoster(
    allianceId: string,
    entries: HistoricalRosterEntry[],
    provenance: ImportProvenance,
    expectedFingerprint: string
): Promise<HistoricalImportResult> {
    const auth = await requireAllianceAccess({ allianceId });

    // Dual-permission gate (#282): historical mode can restore a member's
    // active lifecycle and directly create an already-archived member, both
    // more consequential than the plain create/restore-as-active current
    // roster import performs. Require both capabilities explicitly rather
    // than introducing a new permission — every role that already holds
    // IMPORT_MEMBERS also holds MANAGE_MEMBERS today, but this keeps that
    // an enforced invariant instead of an accident of the current role
    // matrix.
    if (!auth.permissions.canImportMembers || !auth.permissions.canManageMembers) {
        return failResult(["You don't have permission to import a historical roster"]);
    }

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
    const validatedEntries: ValidatedHistoricalEntry[] = structuralResult.validatedEntries;

    try {
        const result = await withAllianceMemberLock(allianceId, async (tx, activeMembersCount) => {
            // Fresh read inside the lock — the single source of truth this
            // entire commit (classification, fingerprint, and the actual
            // mutations) is derived from.
            const existingInTx = await tx.allianceMember.findMany({
                where: { allianceId },
                select: { id: true, playerName: true, archivedAt: true, thp: true, role: true },
            });
            const existingByNormalizedName = new Map<string, ExistingMemberSnapshot>();
            for (const m of existingInTx) {
                existingByNormalizedName.set(normalizeName(m.playerName), m);
            }

            const toCreate: { entry: ValidatedHistoricalEntry; wantArchived: boolean }[] = [];
            const toRestore: { before: ExistingMemberSnapshot; entry: ValidatedHistoricalEntry }[] = [];
            const fingerprintRows: HistoricalFingerprintRow[] = [];

            const seenInTx = new Set<string>();
            let skippedDuplicates = 0;
            let skippedUnselected = 0;
            let skippedExisting = 0;
            let skippedLifecycleConflict = 0;

            for (const entry of validatedEntries) {
                const normalized = normalizeName(entry.playerName);

                // Duplicate-in-file detection consumes the "first occurrence"
                // slot regardless of selection, matching ../action.ts's
                // importMembers() precedent.
                if (seenInTx.has(normalized)) {
                    skippedDuplicates++;
                    continue;
                }
                seenInTx.add(normalized);

                if (entry.selected === false) {
                    skippedUnselected++;
                    continue;
                }

                const existing = existingByNormalizedName.get(normalized);
                const classification = classifyHistoricalRosterRow(
                    { matched: !!existing, currentlyArchived: existing ? existing.archivedAt !== null : false },
                    entry.finalStatus
                );

                if (classification.outcome === "UNASSIGNED_BLOCKED") {
                    // The client blocks confirmation until every selected row
                    // has an outcome — reaching this means either a client
                    // bug or a bypass. Fail the whole import rather than
                    // silently skip: an "unassigned" row is not a decision,
                    // it's a missing one.
                    throw new Error(
                        `Row for player "${entry.playerName}" must have an Active or Archived outcome assigned before importing.`
                    );
                }

                fingerprintRows.push({
                    sourceRow: entry.sourceRow,
                    normalizedName: normalized,
                    matchedMemberId: existing?.id ?? null,
                    currentlyArchived: existing ? existing.archivedAt !== null : null,
                    requestedStatus: entry.finalStatus,
                    appliedFieldPolicy: classification.appliedFieldPolicy,
                });

                switch (classification.outcome) {
                    case "CREATE_ACTIVE":
                        toCreate.push({ entry, wantArchived: false });
                        break;
                    case "CREATE_ARCHIVED":
                        toCreate.push({ entry, wantArchived: true });
                        break;
                    case "RESTORE":
                        // Safe: RESTORE is only ever classified when `existing`
                        // is defined (matched === true).
                        toRestore.push({ before: existing!, entry });
                        break;
                    case "ALREADY_MATCHES":
                        skippedExisting++;
                        break;
                    case "LIFECYCLE_CONFLICT":
                        skippedLifecycleConflict++;
                        break;
                }
            }

            // Stale-preview fail-closed check: compare what this fresh,
            // locked read classifies against exactly what the client
            // reviewed and submitted. Any drift — a different match, a
            // different lifecycle state, a different requested outcome, or
            // a different applied-field policy for any row — aborts the
            // entire import untouched. See this file's own top comment for
            // the concrete scenario this prevents.
            const liveFingerprint = computeHistoricalImportFingerprint(fingerprintRows);
            if (liveFingerprint !== expectedFingerprint) {
                throw new Error(STALE_PREVIEW_ERROR);
            }

            // Applied-field validation: THP is only validated for rows whose
            // classification says the file's value will actually be written
            // (new members). A RESTORE preserves the existing member's
            // current THP/role untouched — validating the historical file's
            // THP for that row would incorrectly block an import over a
            // value that is never applied.
            for (const { entry } of toCreate) {
                const thpResult = validateThpValue(entry.thp, entry.playerName);
                if (!thpResult.success) {
                    throw new Error(thpResult.error);
                }
                entry.parsedThp = thpResult.parsedThp;
            }

            const activeAdditions = toCreate.filter((c) => !c.wantArchived).length + toRestore.length;

            // Domain active roster capacity check. Archived-destined
            // creations never consume capacity (#282) — only new active
            // members and restores-to-active do.
            if (activeMembersCount + activeAdditions > MAX_ACTIVE_ALLIANCE_MEMBERS) {
                const available = getAvailableMemberCapacity(activeMembersCount);
                const overflow = activeMembersCount + activeAdditions - MAX_ACTIVE_ALLIANCE_MEMBERS;
                const createActiveCount = toCreate.filter((c) => !c.wantArchived).length;
                throw new Error(
                    `Your alliance has ${activeMembersCount} active members, so you can add ${available} more. ` +
                        `You currently have ${activeAdditions} members selected that would become active ` +
                        `(${createActiveCount} new, ${toRestore.length} restored). ` +
                        `Deselect ${overflow} member${overflow === 1 ? "" : "s"} to continue.`
                );
            }

            const now = new Date();

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
                    data: toCreate.map(({ entry, wantArchived }) => ({
                        allianceId,
                        playerName: entry.playerName.trim(),
                        thp: entry.parsedThp ?? null,
                        role: entry.role?.trim() ?? null,
                        archivedAt: wantArchived ? now : null,
                    })),
                    skipDuplicates: true,
                });
            }
            const createdCount = createdRows.length;

            // Fail closed on any short create — see ../action.ts's identical
            // guard for why partial creation must roll back the whole
            // transaction rather than commit incomplete history.
            if (createdCount !== toCreate.length) {
                throw new Error(
                    `Import provenance mismatch: expected to create ${toCreate.length} member(s) but only ${createdCount} were created`
                );
            }

            const toCreateByNormalizedName = new Map<string, ValidatedHistoricalEntry>();
            for (const { entry } of toCreate) {
                toCreateByNormalizedName.set(normalizeName(entry.playerName), entry);
            }
            const consumedCreateNames = new Set<string>();
            const matchedCreates: { row: (typeof createdRows)[number]; entry: ValidatedHistoricalEntry }[] = [];
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

            const createdActiveCount = matchedCreates.filter((m) => m.row.archivedAt === null).length;
            const createdArchivedCount = matchedCreates.filter((m) => m.row.archivedAt !== null).length;

            const restoredUpdates: {
                before: ExistingMemberSnapshot;
                entry: ValidatedHistoricalEntry;
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
                // Live guard: condition the restore on the member still
                // being archived at write time, not merely at the earlier
                // `existingInTx` read. Under PostgreSQL READ COMMITTED, a
                // normal (non-locked) member update/archive can commit
                // between that read and this write within the same
                // transaction — see #277 PR 3's rollback flow for the
                // precedent this mirrors. Zero rows affected means the
                // member's lifecycle changed underneath us; fail the whole
                // import rather than restore against stale assumptions.
                const guard = await tx.allianceMember.updateMany({
                    where: { id: item.before.id, allianceId, archivedAt: { not: null } },
                    data: { archivedAt: null },
                });
                if (guard.count !== 1) {
                    throw new Error(STALE_PREVIEW_ERROR);
                }
                const updated = await tx.allianceMember.findFirstOrThrow({
                    where: { id: item.before.id, allianceId },
                });
                restoredUpdates.push({ before: item.before, entry: item.entry, updated });
            }
            const restoredCount = restoredUpdates.length;

            await touchAllianceSetupActivity(tx, allianceId);

            // History gate: only record provenance when the transaction
            // actually mutated at least one member — a zero-net-effect
            // commit (everything skipped/conflicted) writes no history row.
            let memberImportId: string | null = null;
            if (createdCount + restoredCount >= 1) {
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
                        mode: MemberImportMode.HISTORICAL,
                        createdCount,
                        createdArchivedCount,
                        restoredCount,
                        skippedExistingCount: skippedExisting,
                        skippedDuplicateCount: skippedDuplicates,
                        skippedEmptyNameCount: skippedEmptyNames,
                        skippedUnselectedCount: skippedUnselected,
                        skippedLifecycleConflictCount: skippedLifecycleConflict,
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
                                    // Historical mode preserves thp/role on
                                    // restore (#282's field policy) —
                                    // before and after are always equal
                                    // here, unlike a current-roster restore
                                    // which may overwrite them from the file.
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
                createdActive: createdActiveCount,
                createdArchived: createdArchivedCount,
                restored: restoredCount,
                skippedExisting,
                skippedDuplicates,
                skippedEmptyNames,
                skippedUnselected,
                skippedLifecycleConflict,
                errors: [],
                memberImportId,
            };
        });

        revalidateAllianceData({
            allianceId,
            domains: result.memberImportId
                ? ["members", "setup", "dashboard", "reports", "member-imports"]
                : ["members", "setup", "dashboard", "reports"],
        });

        return result;
    } catch (error) {
        console.error("Error importing historical alliance roster:", error);
        const errorMessage =
            error instanceof Error &&
            (error.message.includes("Your alliance has") ||
                error.message.includes("active members") ||
                error.message === STALE_PREVIEW_ERROR ||
                error.message.includes("must have an Active or Archived outcome") ||
                error.message.includes("THP value") ||
                error.message.includes("Total Hero Power"))
                ? error.message
                : "Failed to import historical roster. Please try again.";
        return failResult([errorMessage], skippedEmptyNames);
    }
}
