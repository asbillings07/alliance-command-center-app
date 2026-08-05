import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import type * as Action from "./action";
import { computeImportRollbackPreview, computePreviewFingerprint } from "../rollbackPreview";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("rollbackImport [integration]", () => {
    let prisma: PrismaClient;
    let rollbackImport: typeof Action.rollbackImport;
    const createdAllianceIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
        ({ rollbackImport } = await import("./action"));
    });

    afterEach(async () => {
        if (createdAllianceIds.length > 0) {
            await prisma.memberImportRollbackResult.deleteMany({
                where: { memberImportRollback: { allianceId: { in: createdAllianceIds } } },
            });
            await prisma.memberImportRollback.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
            await prisma.memberImportChange.deleteMany({
                where: { memberImport: { allianceId: { in: createdAllianceIds } } },
            });
            await prisma.memberImport.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
            await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
            await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
            createdAllianceIds.length = 0;
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
            createdUserIds.length = 0;
        }
    });

    async function makeAlliance() {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const alliance = await prisma.alliance.create({
            data: { name: `Rollback Integration Alliance ${suffix}`, server: "1001" },
        });
        createdAllianceIds.push(alliance.id);
        return alliance;
    }

    async function makeOwnerUser() {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const user = await prisma.user.create({
            data: { email: `owner-${suffix}@example.com`, displayName: "Test Owner" },
        });
        createdUserIds.push(user.id);
        return user;
    }

    function mockAuthAs(userId: string) {
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            user: { id: userId },
            permissions: { canRollbackMemberImports: true },
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    }

    /** Computes the same fingerprint a freshly-rendered undo page would embed
     * right now, against real current DB state — used so these tests can
     * simulate "the owner loaded the page, then submitted" without a second
     * HTTP round trip. Any DB state change the test makes *before* calling
     * this (an edit, an archive, a later import, ...) is exactly what the
     * page would have rendered, and is legitimately reflected in what gets
     * submitted; a change made *after* is what production's staleness gate
     * exists to catch. */
    async function computeFingerprintForImport(importId: string): Promise<string> {
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
        const preview = await computeImportRollbackPreview(prisma, memberImport, memberImport.changes);
        return computePreviewFingerprint(preview.items);
    }

    async function buildFormData(
        allianceId: string,
        importId: string,
        resolutions: Record<string, string> = {}
    ): Promise<FormData> {
        const formData = new FormData();
        formData.set("allianceId", allianceId);
        formData.set("importId", importId);
        formData.set("previewFingerprint", await computeFingerprintForImport(importId));
        for (const [changeId, choice] of Object.entries(resolutions)) {
            formData.set(`resolution:${changeId}`, choice);
        }
        return formData;
    }

    /** Creates a MemberImport with a single CREATED change for a brand-new
     * member, mirroring exactly what importMembers() itself writes. */
    async function seedCreatedImport(allianceId: string) {
        const member = await prisma.allianceMember.create({
            data: { allianceId, playerName: `Created Member ${Date.now()}-${Math.random()}`, thp: 1000, role: "Member" },
        });
        const memberImport = await prisma.memberImport.create({
            data: {
                allianceId,
                actorEmailSnapshot: "actor@example.com",
                fileName: "roster.xlsx",
                sourceSheetName: "Sheet1",
                createdCount: 1,
                restoredCount: 0,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
                changes: {
                    create: [
                        {
                            allianceMemberId: member.id,
                            playerNameSnapshot: member.playerName,
                            sourceRow: 1,
                            changeType: MemberImportChangeType.CREATED,
                            archivedAtBefore: null,
                            archivedAtAfter: null,
                            thpBefore: null,
                            thpAfter: member.thp,
                            roleBefore: null,
                            roleAfter: member.role,
                            discordNameAfter: member.discordName,
                            squadPowerAfter: member.squadPower,
                            joinedAtAfter: member.joinedAt,
                            userIdAfter: member.userId,
                            memberUpdatedAtAfter: member.updatedAt,
                        },
                    ],
                },
            },
            select: { id: true, changes: { select: { id: true } } },
        });
        return { memberId: member.id, memberImportId: memberImport.id, changeId: memberImport.changes[0].id };
    }

    /** Creates an already-archived member, then a MemberImport with a single
     * RESTORED change for it — mirroring what importMembers() writes for a
     * restore. */
    async function seedRestoredImport(allianceId: string) {
        const before = await prisma.allianceMember.create({
            data: {
                allianceId,
                playerName: `Restored Member ${Date.now()}-${Math.random()}`,
                thp: 500,
                role: "Elder",
                archivedAt: new Date("2025-01-01T00:00:00Z"),
            },
        });
        const restored = await prisma.allianceMember.update({
            where: { id: before.id },
            data: { archivedAt: null, thp: 2000, role: "Officer" },
        });
        const memberImport = await prisma.memberImport.create({
            data: {
                allianceId,
                actorEmailSnapshot: "actor@example.com",
                fileName: "roster.xlsx",
                sourceSheetName: "Sheet1",
                createdCount: 0,
                restoredCount: 1,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
                changes: {
                    create: [
                        {
                            allianceMemberId: restored.id,
                            playerNameSnapshot: restored.playerName,
                            sourceRow: 1,
                            changeType: MemberImportChangeType.RESTORED,
                            archivedAtBefore: before.archivedAt,
                            archivedAtAfter: restored.archivedAt,
                            thpBefore: before.thp,
                            thpAfter: restored.thp,
                            roleBefore: before.role,
                            roleAfter: restored.role,
                            discordNameAfter: restored.discordName,
                            squadPowerAfter: restored.squadPower,
                            joinedAtAfter: restored.joinedAt,
                            userIdAfter: restored.userId,
                            memberUpdatedAtAfter: restored.updatedAt,
                        },
                    ],
                },
            },
            select: { id: true, changes: { select: { id: true } } },
        });
        return {
            memberId: restored.id,
            memberImportId: memberImport.id,
            changeId: memberImport.changes[0].id,
            preImportArchivedAt: before.archivedAt,
            preImportThp: before.thp,
            preImportRole: before.role,
        };
    }

    it("integration: cleanly deletes a CREATED member and records a fully-clean ROLLED_BACK header matching its one result row", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);
        const { memberId, memberImportId } = await seedCreatedImport(alliance.id);

        const result = await rollbackImport(await buildFormData(alliance.id, memberImportId));

        expect(result).toMatchObject({ success: true, outcome: "ROLLED_BACK", deletedCount: 1 });

        const stillExists = await prisma.allianceMember.findUnique({ where: { id: memberId } });
        expect(stillExists).toBeNull();

        const header = await prisma.memberImportRollback.findUniqueOrThrow({
            where: { memberImportId },
            include: { results: true },
        });
        expect(header.deletedCount).toBe(1);
        expect(header.results).toHaveLength(1);
        expect(header.results[0].resolution).toBe("DELETED");
    });

    it("integration: cleanly reverts a RESTORED member's archivedAt/thp/role to its pre-import snapshot as one unit", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);
        const { memberId, memberImportId, preImportArchivedAt, preImportThp, preImportRole } =
            await seedRestoredImport(alliance.id);

        const result = await rollbackImport(await buildFormData(alliance.id, memberImportId));

        expect(result).toMatchObject({ success: true, outcome: "ROLLED_BACK", revertedCount: 1 });

        const reverted = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(reverted.archivedAt?.getTime()).toBe(preImportArchivedAt?.getTime());
        expect(reverted.thp).toBe(preImportThp);
        expect(reverted.role).toBe(preImportRole);
    });

    it("integration: a real edit since import forces a conflict, and the owner's explicit choice is honored exactly", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);
        const { memberId, memberImportId, changeId } = await seedCreatedImport(alliance.id);

        // A real edit lands after the import — e.g. someone corrected THP.
        await prisma.allianceMember.update({ where: { id: memberId }, data: { thp: 9999 } });

        const result = await rollbackImport(
            await buildFormData(alliance.id, memberImportId, { [changeId]: "ARCHIVE_PRESERVING_HISTORY" })
        );

        expect(result).toMatchObject({
            success: true,
            outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
            archivedPreservingHistoryCount: 1,
        });

        const member = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(member.archivedAt).not.toBeNull();
        expect(member.thp).toBe(9999); // never reverted — only archived

        const result2 = await prisma.memberImportRollbackResult.findUniqueOrThrow({
            where: { memberImportChangeId: changeId },
        });
        expect(result2.resolution).toBe("ARCHIVED_PRESERVING_HISTORY");
        expect(result2.driftedFields).toContain("thp");
    });

    it("integration: rejects rolling back without a submitted resolution when a real conflict exists — never silently guesses", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);
        const { memberId, memberImportId } = await seedCreatedImport(alliance.id);
        await prisma.allianceMember.update({ where: { id: memberId }, data: { thp: 9999 } });

        const result = await rollbackImport(await buildFormData(alliance.id, memberImportId));

        expect(result).toMatchObject({ success: false });
        const stillExists = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(stillExists.thp).toBe(9999); // completely untouched
        const header = await prisma.memberImportRollback.findUnique({ where: { memberImportId } });
        expect(header).toBeNull(); // nothing committed
    });

    it("integration: a fingerprint computed before a conflicting edit is rejected as stale, never deleting or reverting the now-edited member", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);
        const { memberId, memberImportId } = await seedCreatedImport(alliance.id);

        // Simulates "the owner loaded the undo page" — a fingerprint
        // computed against the clean, pre-edit state (the same one that
        // would have rendered "Delete (undo creation)" with no resolution
        // needed).
        const staleFingerprint = await computeFingerprintForImport(memberImportId);

        // Then, before the owner submits, a real edit lands.
        await prisma.allianceMember.update({ where: { id: memberId }, data: { thp: 9999 } });

        const formData = new FormData();
        formData.set("allianceId", alliance.id);
        formData.set("importId", memberImportId);
        formData.set("previewFingerprint", staleFingerprint);

        const result = await rollbackImport(formData);

        expect(result).toEqual({
            success: false,
            error:
                "This import's state changed since you loaded this page. Review the updated preview and try again.",
        });
        const stillExists = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(stillExists.thp).toBe(9999); // untouched, not deleted against stale evidence
        const header = await prisma.memberImportRollback.findUnique({ where: { memberImportId } });
        expect(header).toBeNull();
    });

    it("integration: a genuinely later import touching the same member blocks rollback via later-import involvement, independent of scalar drift", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);

        // Import A restores member X to (thp: 2000, role: Officer, active).
        const { memberId, memberImportId: importAId, changeId } = await seedRestoredImport(alliance.id);

        // The member is archived again, then a *later* import (Import C)
        // restores it back to the exact same (thp, role) — scalars end up
        // identical to Import A's own "after" snapshot, but Import C's own
        // change row for this member is real, later history.
        await prisma.allianceMember.update({ where: { id: memberId }, data: { archivedAt: new Date() } });
        const reRestored = await prisma.allianceMember.update({
            where: { id: memberId },
            data: { archivedAt: null, thp: 2000, role: "Officer" },
        });
        await prisma.memberImport.create({
            data: {
                allianceId: alliance.id,
                actorEmailSnapshot: "actor@example.com",
                fileName: "roster-later.xlsx",
                sourceSheetName: "Sheet1",
                createdCount: 0,
                restoredCount: 1,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
                changes: {
                    create: [
                        {
                            allianceMemberId: reRestored.id,
                            playerNameSnapshot: reRestored.playerName,
                            sourceRow: 1,
                            changeType: MemberImportChangeType.RESTORED,
                            archivedAtBefore: new Date(),
                            archivedAtAfter: null,
                            thpBefore: 2000,
                            thpAfter: 2000,
                            roleBefore: "Officer",
                            roleAfter: "Officer",
                            discordNameAfter: reRestored.discordName,
                            squadPowerAfter: reRestored.squadPower,
                            joinedAtAfter: reRestored.joinedAt,
                            userIdAfter: reRestored.userId,
                            memberUpdatedAtAfter: reRestored.updatedAt,
                        },
                    ],
                },
            },
        });

        // Rolling back the *original* Import A must be blocked — the member
        // has real, later import history Import A's own snapshot knows
        // nothing about — even though thp/role/archivedAt (the human-visible
        // fields) happen to end up identical to Import A's own recording.
        // (updatedAt necessarily also drifts here, since the intervening
        // archive+re-restore both bump it regardless of value — the
        // meaningful assertion is that later-import involvement is recorded
        // as *its own*, independent conflict reason, not that it's the only
        // one present.)
        const result = await rollbackImport(await buildFormData(alliance.id, importAId));

        expect(result).toMatchObject({ success: true, outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS" });
        const resultRow = await prisma.memberImportRollbackResult.findUniqueOrThrow({
            where: { memberImportChangeId: changeId },
        });
        expect(resultRow.resolution).toBe("SKIPPED_CONFLICT");
        expect(resultRow.hadLaterImportInvolvement).toBe(true);
        expect(resultRow.driftedFields).not.toEqual(
            expect.arrayContaining(["thp", "role", "archivedAt"])
        );

        // Untouched — a conflicted RESTORED row is never actionable.
        const finalMember = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(finalMember.archivedAt).toBeNull();
        expect(finalMember.thp).toBe(2000);
    });

    it("integration: a member's own earlier, unrelated import history never blocks its later rollback", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);

        // Import A creates member X.
        const { memberId } = await seedCreatedImport(alliance.id);
        const created = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });

        // The member is archived, then Import B restores it — Import B is
        // the one being rolled back here, and Import A (its own creation)
        // predates it and must not count as "later" involvement.
        await prisma.allianceMember.update({ where: { id: memberId }, data: { archivedAt: new Date() } });
        const restored = await prisma.allianceMember.update({
            where: { id: memberId },
            data: { archivedAt: null, thp: created.thp ?? undefined, role: created.role ?? undefined },
        });
        const importB = await prisma.memberImport.create({
            data: {
                allianceId: alliance.id,
                actorEmailSnapshot: "actor@example.com",
                fileName: "roster-b.xlsx",
                sourceSheetName: "Sheet1",
                createdCount: 0,
                restoredCount: 1,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
                changes: {
                    create: [
                        {
                            allianceMemberId: restored.id,
                            playerNameSnapshot: restored.playerName,
                            sourceRow: 1,
                            changeType: MemberImportChangeType.RESTORED,
                            archivedAtBefore: new Date(),
                            archivedAtAfter: null,
                            thpBefore: restored.thp,
                            thpAfter: restored.thp,
                            roleBefore: restored.role,
                            roleAfter: restored.role,
                            discordNameAfter: restored.discordName,
                            squadPowerAfter: restored.squadPower,
                            joinedAtAfter: restored.joinedAt,
                            userIdAfter: restored.userId,
                            memberUpdatedAtAfter: restored.updatedAt,
                        },
                    ],
                },
            },
        });

        const result = await rollbackImport(await buildFormData(alliance.id, importB.id));

        expect(result).toMatchObject({ success: true, outcome: "ROLLED_BACK", revertedCount: 1 });
        const final = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(final.archivedAt).not.toBeNull(); // reverted to (its recorded) pre-import archived state
    });

    it("integration: two concurrent rollback submissions for the same import serialize cleanly — exactly one succeeds, the other reports already-undone, never a raw constraint crash", async () => {
        const alliance = await makeAlliance();
        const owner = await makeOwnerUser();
        mockAuthAs(owner.id);
        const { memberImportId } = await seedCreatedImport(alliance.id);

        const [resA, resB] = await Promise.all([
            rollbackImport(await buildFormData(alliance.id, memberImportId)),
            rollbackImport(await buildFormData(alliance.id, memberImportId)),
        ]);

        const successCount = [resA, resB].filter((r) => r.success).length;
        const failureCount = [resA, resB].filter((r) => !r.success).length;
        expect(successCount).toBe(1);
        expect(failureCount).toBe(1);

        const failed = [resA, resB].find((r) => !r.success)!;
        if (failed.success) throw new Error("expected failure");
        expect(failed.error).toBe("This import has already been undone.");

        const headers = await prisma.memberImportRollback.findMany({ where: { memberImportId } });
        expect(headers).toHaveLength(1);
    });
});
