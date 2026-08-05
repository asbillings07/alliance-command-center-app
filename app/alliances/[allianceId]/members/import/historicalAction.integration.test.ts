import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as HistoricalAction from "./historicalAction";
import type * as UndoAction from "../imports/[importId]/undo/action";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { classifyHistoricalRosterRow } from "./historicalClassification";
import { computeHistoricalImportFingerprint } from "./historicalImportFingerprint";
import type { HistoricalFingerprintRow } from "./historicalImportFingerprint";
import type { HistoricalRosterEntry } from "./historicalAction";
import { computeImportRollbackPreview, computePreviewFingerprint } from "../imports/[importId]/rollbackPreview";

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

const provenance = { fileName: "historical-roster.xlsx", sourceSheetName: "1998 Roster" };

/** Adds a unique, sequential sourceRow to every entry in a raw entries array. */
function withSourceRows(rawEntries: Omit<HistoricalRosterEntry, "sourceRow">[]): HistoricalRosterEntry[] {
    return rawEntries.map((e, i) => ({ ...e, sourceRow: i + 1 }));
}

describe.skipIf(!runDb)("importHistoricalRoster [integration]", () => {
    let prisma: PrismaClient;
    let importHistoricalRoster: typeof HistoricalAction.importHistoricalRoster;
    let rollbackImport: typeof UndoAction.rollbackImport;
    const createdAllianceIds: string[] = [];

    // The MemberImport -> User FK requires a real, persisted actor.
    let testActor: { id: string; email: string };

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
            prisma: PrismaClient;
        });
        ({ importHistoricalRoster } = await import("./historicalAction"));
        ({ rollbackImport } = await import("../imports/[importId]/undo/action"));

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const user = await prisma.user.create({
            data: {
                email: `historical-integration-actor-${suffix}@test.local`,
                displayName: "Historical Integration Actor",
            },
        });
        testActor = { id: user.id, email: user.email };
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { id: testActor.id } });
    });

    beforeEach(() => {
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            user: testActor,
            permissions: {
                canManageMembers: true,
                canImportMembers: true,
                canRollbackMemberImports: true,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "OWNER" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });
    });

    afterEach(async () => {
        if (createdAllianceIds.length > 0) {
            await prisma.memberImportRollbackResult.deleteMany({
                where: { memberImportRollback: { allianceId: { in: createdAllianceIds } } },
            });
            await prisma.memberImportRollback.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
            await prisma.leadershipNote.deleteMany({
                where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
            });
            await prisma.memberImportChange.deleteMany({
                where: { memberImport: { allianceId: { in: createdAllianceIds } } },
            });
            await prisma.memberImport.deleteMany({
                where: { allianceId: { in: createdAllianceIds } },
            });
            await prisma.allianceMember.deleteMany({
                where: { allianceId: { in: createdAllianceIds } },
            });
            await prisma.alliance.deleteMany({
                where: { id: { in: createdAllianceIds } },
            });
            createdAllianceIds.length = 0;
        }
    });

    async function makeAlliance() {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const alliance = await prisma.alliance.create({
            data: { name: `Historical Import Integration Alliance ${suffix}`, server: "1001" },
        });
        createdAllianceIds.push(alliance.id);
        return alliance;
    }

    async function makeAllianceWithActiveMembers(activeCount: number) {
        const alliance = await makeAlliance();
        if (activeCount > 0) {
            const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            await prisma.allianceMember.createMany({
                data: Array.from({ length: activeCount }, (_, i) => ({
                    allianceId: alliance.id,
                    playerName: `Existing Active Member ${suffix}-${i + 1}`,
                })),
            });
        }
        return alliance;
    }

    /**
     * Mirrors exactly what a well-behaved client computes at "preview time":
     * classify every selected entry against the alliance's *current* live
     * members (read at the moment this is called, not inside any lock), then
     * fingerprint it. Tests call this before making a concurrent DB change to
     * build a fingerprint that's valid at read time but becomes stale by the
     * time `importHistoricalRoster` actually commits — exactly the race the
     * production client/server split is meant to catch.
     */
    async function computeLiveFingerprint(allianceId: string, entries: HistoricalRosterEntry[]): Promise<string> {
        const existingMembers = await prisma.allianceMember.findMany({
            where: { allianceId },
            select: { id: true, playerName: true, archivedAt: true },
        });
        const existingByName = new Map(existingMembers.map((m) => [normalizeName(m.playerName), m]));
        const seen = new Set<string>();
        const rows: HistoricalFingerprintRow[] = [];

        for (const entry of entries) {
            const normalized = normalizeName(entry.playerName);
            if (seen.has(normalized) || entry.selected === false) continue;
            seen.add(normalized);

            const existing = existingByName.get(normalized);
            const classification = classifyHistoricalRosterRow(
                { matched: !!existing, currentlyArchived: existing ? existing.archivedAt !== null : false },
                entry.finalStatus
            );
            rows.push({
                sourceRow: entry.sourceRow,
                normalizedName: normalized,
                matchedMemberId: existing?.id ?? null,
                currentlyArchived: existing ? existing.archivedAt !== null : null,
                requestedStatus: entry.finalStatus,
                appliedFieldPolicy: classification.appliedFieldPolicy,
            });
        }
        return computeHistoricalImportFingerprint(rows);
    }

    it("integration: creates active and archived members in the same import, with createdArchivedCount as an exact subset of createdCount", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);
        const entries = withSourceRows([
            { playerName: "New Active Recruit", thp: "10000", finalStatus: "active" },
            { playerName: "Old Veteran One", thp: "20000", finalStatus: "archived" },
            { playerName: "Old Veteran Two", thp: "30000", finalStatus: "archived" },
        ]);
        const fingerprint = await computeLiveFingerprint(alliance.id, entries);

        const result = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);

        expect(result.errors).toHaveLength(0);
        expect(result.createdActive).toBe(1);
        expect(result.createdArchived).toBe(2);
        expect(result.memberImportId).not.toBeNull();

        const memberImport = await prisma.memberImport.findUniqueOrThrow({
            where: { id: result.memberImportId! },
        });
        expect(memberImport.mode).toBe("HISTORICAL");
        expect(memberImport.createdCount).toBe(3);
        expect(memberImport.createdArchivedCount).toBe(2);
        expect(memberImport.createdArchivedCount).toBeLessThanOrEqual(memberImport.createdCount);

        const activeCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        const archivedCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: { not: null } },
        });
        expect(activeCount).toBe(1);
        expect(archivedCount).toBe(2);
    });

    it("integration: archived-destined creations consume zero active capacity, so a 99-active alliance can still create many archived rows", async () => {
        const alliance = await makeAllianceWithActiveMembers(99);
        const entries = withSourceRows(
            Array.from({ length: 10 }, (_, i) => ({
                playerName: `Historical Archived Player ${i + 1}`,
                finalStatus: "archived" as const,
            }))
        );
        const fingerprint = await computeLiveFingerprint(alliance.id, entries);

        const result = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);

        expect(result.errors).toHaveLength(0);
        expect(result.createdActive).toBe(0);
        expect(result.createdArchived).toBe(10);

        const activeCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(activeCount).toBe(99);
    });

    it("integration: serializes two simultaneous historical imports so total active count never exceeds 100", async () => {
        const alliance = await makeAllianceWithActiveMembers(90);

        const entries1 = withSourceRows(
            Array.from({ length: 10 }, (_, i) => ({
                playerName: `Concurrent Historical Batch A ${i + 1}`,
                finalStatus: "active" as const,
            }))
        );
        const entries2 = withSourceRows(
            Array.from({ length: 10 }, (_, i) => ({
                playerName: `Concurrent Historical Batch B ${i + 1}`,
                finalStatus: "active" as const,
            }))
        );

        const [fingerprint1, fingerprint2] = await Promise.all([
            computeLiveFingerprint(alliance.id, entries1),
            computeLiveFingerprint(alliance.id, entries2),
        ]);

        const [res1, res2] = await Promise.all([
            importHistoricalRoster(alliance.id, entries1, provenance, fingerprint1),
            importHistoricalRoster(alliance.id, entries2, provenance, fingerprint2),
        ]);

        const successCount = [res1, res2].filter((r) => r.createdActive === 10).length;
        const failedCount = [res1, res2].filter(
            (r) => r.createdActive === 0 && r.errors.length > 0
        ).length;

        expect(successCount).toBe(1);
        expect(failedCount).toBe(1);

        const failedResult = [res1, res2].find((r) => r.createdActive === 0)!;
        expect(failedResult.errors[0]).toContain("Your alliance has 100 active members");
        expect(failedResult.memberImportId).toBeNull();

        const finalActiveCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(finalActiveCount).toBe(100);
    });

    it("integration: restoring an archived member preserves its current thp/role, ignoring the historical file's values", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);
        const archivedMember = await prisma.allianceMember.create({
            data: {
                allianceId: alliance.id,
                playerName: "Restorable Historical Hero",
                thp: 15000,
                role: "R3",
                archivedAt: new Date("2025-01-01T00:00:00Z"),
            },
        });

        const entries = withSourceRows([
            {
                playerName: "Restorable Historical Hero",
                thp: "999999", // historical file value — must never be applied
                role: "R9",
                finalStatus: "active",
            },
        ]);
        const fingerprint = await computeLiveFingerprint(alliance.id, entries);

        const result = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);

        expect(result.restored).toBe(1);
        expect(result.errors).toHaveLength(0);

        const restored = await prisma.allianceMember.findUniqueOrThrow({ where: { id: archivedMember.id } });
        expect(restored.archivedAt).toBeNull();
        expect(restored.thp).toBe(15000); // preserved, not overwritten from the file
        expect(restored.role).toBe("R3");

        const change = await prisma.memberImportChange.findFirstOrThrow({
            where: { memberImportId: result.memberImportId!, allianceMemberId: archivedMember.id },
        });
        expect(change.changeType).toBe("RESTORED");
        expect(change.thpBefore).toBe(15000);
        expect(change.thpAfter).toBe(15000);
        expect(change.roleBefore).toBe("R3");
        expect(change.roleAfter).toBe("R3");
    });

    it("integration: a currently-active member requested as archived is left completely untouched and recorded as a lifecycle conflict", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);
        const activeMember = await prisma.allianceMember.create({
            data: { allianceId: alliance.id, playerName: "Currently Active Player", thp: 5000, role: "R2" },
        });

        const entries = withSourceRows([
            { playerName: "Currently Active Player", thp: "5000", finalStatus: "archived" },
        ]);
        const fingerprint = await computeLiveFingerprint(alliance.id, entries);

        const result = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);

        expect(result.errors).toHaveLength(0);
        expect(result.skippedLifecycleConflict).toBe(1);
        expect(result.createdActive).toBe(0);
        expect(result.createdArchived).toBe(0);
        expect(result.restored).toBe(0);
        // Zero-mutation outcome: nothing was actually created or restored,
        // so no MemberImport row should be written at all.
        expect(result.memberImportId).toBeNull();

        const untouched = await prisma.allianceMember.findUniqueOrThrow({ where: { id: activeMember.id } });
        expect(untouched.archivedAt).toBeNull();
        expect(untouched.thp).toBe(5000);
        expect(untouched.role).toBe("R2");

        const importCount = await prisma.memberImport.count({ where: { allianceId: alliance.id } });
        expect(importCount).toBe(0);
    });

    it("integration: a lifecycle change between preview and commit aborts the whole import instead of silently reclassifying the row", async () => {
        // Regression coverage for the exact race called out in planning:
        // preview says "existing active + requested active -> no change",
        // then a concurrent archive lands, and execution must NOT
        // reinterpret that as "existing archived + requested active ->
        // restore" and silently reverse the concurrent archive.
        const alliance = await makeAllianceWithActiveMembers(0);
        const member = await prisma.allianceMember.create({
            data: { allianceId: alliance.id, playerName: "Concurrently Archived Player", thp: 1000, role: "R1" },
        });

        const entries = withSourceRows([
            { playerName: "Concurrently Archived Player", thp: "1000", finalStatus: "active" },
        ]);

        // Fingerprint computed while the member is still active — exactly
        // what a client that loaded the page a moment ago would have.
        const staleFingerprint = await computeLiveFingerprint(alliance.id, entries);

        // A different leader archives the member before this submission commits.
        await prisma.allianceMember.update({ where: { id: member.id }, data: { archivedAt: new Date() } });

        const result = await importHistoricalRoster(alliance.id, entries, provenance, staleFingerprint);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("preview is out of date");
        expect(result.createdActive).toBe(0);
        expect(result.restored).toBe(0);
        expect(result.memberImportId).toBeNull();

        // The concurrent archive must be exactly what it was — never
        // silently restored by this stale submission.
        const stillArchived = await prisma.allianceMember.findUniqueOrThrow({ where: { id: member.id } });
        expect(stillArchived.archivedAt).not.toBeNull();

        const importCount = await prisma.memberImport.count({ where: { allianceId: alliance.id } });
        expect(importCount).toBe(0);
    });

    it("integration: a restore target re-archived between preview and commit is caught by the live guard, aborting the whole import", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);
        const archivedMember = await prisma.allianceMember.create({
            data: {
                allianceId: alliance.id,
                playerName: "Restore Race Player",
                thp: 2000,
                role: "R2",
                archivedAt: new Date("2025-06-01T00:00:00Z"),
            },
        });

        const entries = withSourceRows([
            { playerName: "Restore Race Player", thp: "2000", finalStatus: "active" },
        ]);

        // Preview computed while the member is archived (as expected for a
        // RESTORE classification).
        const fingerprint = await computeLiveFingerprint(alliance.id, entries);

        // Simulate someone else restoring the member manually in between —
        // the row's live guard (`archivedAt: { not: null }` in the update)
        // must catch this, matching PR3's restore-race precedent.
        await prisma.allianceMember.update({ where: { id: archivedMember.id }, data: { archivedAt: null } });

        const result = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);

        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.restored).toBe(0);
        expect(result.memberImportId).toBeNull();

        // Untouched by this import — already active from the concurrent
        // manual restore, and not re-mutated on top of that.
        const stillActive = await prisma.allianceMember.findUniqueOrThrow({ where: { id: archivedMember.id } });
        expect(stillActive.archivedAt).toBeNull();

        const importCount = await prisma.memberImport.count({ where: { allianceId: alliance.id } });
        expect(importCount).toBe(0);
    });

    it("integration: an active member in a different alliance never matches by name — a same-named row is created fresh, not restored or skipped", async () => {
        const allianceA = await makeAllianceWithActiveMembers(0);
        const allianceB = await makeAllianceWithActiveMembers(0);

        await prisma.allianceMember.create({
            data: { allianceId: allianceB.id, playerName: "Shared Name Player", thp: 999, role: "R9", archivedAt: new Date() },
        });

        const entries = withSourceRows([
            { playerName: "Shared Name Player", thp: "1234", role: "R1", finalStatus: "active" },
        ]);
        const fingerprint = await computeLiveFingerprint(allianceA.id, entries);

        const result = await importHistoricalRoster(allianceA.id, entries, provenance, fingerprint);

        expect(result.errors).toHaveLength(0);
        expect(result.createdActive).toBe(1);
        expect(result.restored).toBe(0);

        const createdInA = await prisma.allianceMember.findFirstOrThrow({
            where: { allianceId: allianceA.id, playerName: "Shared Name Player" },
        });
        expect(createdInA.archivedAt).toBeNull();
        expect(createdInA.thp).toBe(1234);

        // The other alliance's member is completely untouched.
        const stillInB = await prisma.allianceMember.findFirstOrThrow({
            where: { allianceId: allianceB.id, playerName: "Shared Name Player" },
        });
        expect(stillInB.archivedAt).not.toBeNull();
        expect(stillInB.thp).toBe(999);
    });

    it("integration: rejects the whole import and creates zero members when the actor lacks canManageMembers", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            user: testActor,
            permissions: { canManageMembers: false, canImportMembers: true } as unknown as Awaited<
                ReturnType<typeof requireAllianceAccess>
            >["permissions"],
            membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });

        const entries = withSourceRows([
            { playerName: "Should Not Be Created", finalStatus: "active" },
        ]);
        const fingerprint = await computeLiveFingerprint(alliance.id, entries);

        const result = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);

        expect(result.errors[0]).toContain("permission");
        expect(result.memberImportId).toBeNull();

        const memberCount = await prisma.allianceMember.count({ where: { allianceId: alliance.id } });
        expect(memberCount).toBe(0);
    });

    describe("rollback regression: create-archived rows through PR3's unmodified rollback code", () => {
        async function computeUndoFingerprint(allianceId: string, importId: string): Promise<string> {
            const memberImport = await prisma.memberImport.findUniqueOrThrow({
                where: { id: importId },
                select: {
                    id: true,
                    createdAt: true,
                    changes: {
                        select: {
                            id: true,
                            memberImportId: true,
                            allianceMemberId: true,
                            playerNameSnapshot: true,
                            sourceRow: true,
                            changeType: true,
                            archivedAtAfter: true,
                            thpAfter: true,
                            roleAfter: true,
                            discordNameAfter: true,
                            squadPowerAfter: true,
                            joinedAtAfter: true,
                            userIdAfter: true,
                            memberUpdatedAtAfter: true,
                        },
                    },
                },
            });
            const preview = await computeImportRollbackPreview(prisma, allianceId, memberImport, memberImport.changes);
            return computePreviewFingerprint(preview.items);
        }

        function buildRollbackFormData(allianceId: string, importId: string, fingerprint: string): FormData {
            const formData = new FormData();
            formData.set("allianceId", allianceId);
            formData.set("importId", importId);
            formData.set("previewFingerprint", fingerprint);
            return formData;
        }

        it("integration: an unmodified create-archived row deletes cleanly via rollbackImport, exactly like a create-active row", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);
            const entries = withSourceRows([
                { playerName: "Archived Creation To Undo", thp: "8000", finalStatus: "archived" },
            ]);
            const fingerprint = await computeLiveFingerprint(alliance.id, entries);
            const importResult = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);
            expect(importResult.createdArchived).toBe(1);
            expect(importResult.memberImportId).not.toBeNull();

            const createdMember = await prisma.allianceMember.findFirstOrThrow({
                where: { allianceId: alliance.id, playerName: "Archived Creation To Undo" },
            });
            expect(createdMember.archivedAt).not.toBeNull();

            const undoFingerprint = await computeUndoFingerprint(alliance.id, importResult.memberImportId!);
            const rollbackResult = await rollbackImport(
                buildRollbackFormData(alliance.id, importResult.memberImportId!, undoFingerprint)
            );

            expect(rollbackResult).toMatchObject({ success: true, outcome: "ROLLED_BACK", deletedCount: 1 });

            const gone = await prisma.allianceMember.findUnique({ where: { id: createdMember.id } });
            expect(gone).toBeNull();
        });

        it("integration: a create-archived row that later gained a leadership note is retained archived, never deleted", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);
            const entries = withSourceRows([
                { playerName: "Archived Creation With History", thp: "9000", finalStatus: "archived" },
            ]);
            const fingerprint = await computeLiveFingerprint(alliance.id, entries);
            const importResult = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);
            expect(importResult.createdArchived).toBe(1);

            const createdMember = await prisma.allianceMember.findFirstOrThrow({
                where: { allianceId: alliance.id, playerName: "Archived Creation With History" },
            });

            // Real organizational history recorded against this member since
            // the import — a protected dependency PR3's rollback preview
            // must treat as a conflict, exactly as it would for a
            // create-active row.
            await prisma.leadershipNote.create({
                data: {
                    allianceMemberId: createdMember.id,
                    authorId: testActor.id,
                    noteType: "OBSERVATION",
                    visibility: "LEADERSHIP",
                    content: "Historical note recorded after archived creation.",
                },
            });

            const undoFingerprint = await computeUndoFingerprint(alliance.id, importResult.memberImportId!);
            const rollbackResult = await rollbackImport(
                buildRollbackFormData(alliance.id, importResult.memberImportId!, undoFingerprint)
            );

            expect(rollbackResult).toMatchObject({
                success: true,
                outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
                retainedArchivedCount: 1,
            });

            // Never deleted or reactivated — already-archived is the only
            // safe outcome once there's a real conflict (no reactivation as
            // a side effect of rollback).
            const stillThere = await prisma.allianceMember.findUniqueOrThrow({ where: { id: createdMember.id } });
            expect(stillThere.archivedAt).not.toBeNull();

            const resultRow = await prisma.memberImportRollbackResult.findUniqueOrThrow({
                where: {
                    memberImportChangeId: (
                        await prisma.memberImportChange.findFirstOrThrow({
                            where: { memberImportId: importResult.memberImportId!, allianceMemberId: createdMember.id },
                        })
                    ).id,
                },
            });
            expect(resultRow.resolution).toBe("RETAINED_ARCHIVED");
            expect(resultRow.leadershipNoteCount).toBe(1);
        });

        it("integration: a mixed active+archived historical import rolls back the active row and retains the archived row independently", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);
            const entries = withSourceRows([
                { playerName: "Mixed Active Creation", thp: "1000", finalStatus: "active" },
                { playerName: "Mixed Archived Creation", thp: "2000", finalStatus: "archived" },
            ]);
            const fingerprint = await computeLiveFingerprint(alliance.id, entries);
            const importResult = await importHistoricalRoster(alliance.id, entries, provenance, fingerprint);
            expect(importResult.createdActive).toBe(1);
            expect(importResult.createdArchived).toBe(1);

            const undoFingerprint = await computeUndoFingerprint(alliance.id, importResult.memberImportId!);
            const rollbackResult = await rollbackImport(
                buildRollbackFormData(alliance.id, importResult.memberImportId!, undoFingerprint)
            );

            expect(rollbackResult).toMatchObject({ success: true, outcome: "ROLLED_BACK", deletedCount: 2 });

            const remaining = await prisma.allianceMember.count({ where: { allianceId: alliance.id } });
            expect(remaining).toBe(0);
        });
    });
});
