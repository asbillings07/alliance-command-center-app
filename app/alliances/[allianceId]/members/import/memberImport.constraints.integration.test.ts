import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

/**
 * Defense-in-depth verification for the hand-written CHECK constraints added
 * in the member_import_provenance migration (#277 PR 1). The application
 * (action.ts) never produces these shapes; these tests confirm a bug there
 * could never persist an inconsistent row, by attempting the violation
 * directly against MemberImport/MemberImportChange — matches the
 * AccessRequestTriageEvent constraint-test precedent.
 */
describeIntegration("MemberImport / MemberImportChange CHECK constraints [integration]", () => {
    let prisma: PrismaClient;
    const createdAllianceIds: string[] = [];

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
    });

    afterEach(async () => {
        if (createdAllianceIds.length > 0) {
            await prisma.memberImportChange.deleteMany({
                where: { memberImport: { allianceId: { in: createdAllianceIds } } },
            });
            await prisma.memberImport.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
            await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
            await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
            createdAllianceIds.length = 0;
        }
    });

    async function makeAlliance() {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const alliance = await prisma.alliance.create({
            data: { name: `Constraint Test Alliance ${suffix}`, server: "1001" },
        });
        createdAllianceIds.push(alliance.id);
        return alliance;
    }

    type MemberImportOverrides = Partial<{
        createdCount: number;
        createdArchivedCount: number;
        restoredCount: number;
        skippedExistingCount: number;
        skippedDuplicateCount: number;
        skippedEmptyNameCount: number;
        skippedUnselectedCount: number;
        skippedLifecycleConflictCount: number;
        mode: "CURRENT" | "HISTORICAL";
    }>;

    async function makeMemberImport(allianceId: string, overrides: MemberImportOverrides = {}) {
        return prisma.memberImport.create({
            data: {
                allianceId,
                actorEmailSnapshot: "actor@example.test",
                fileName: "roster.xlsx",
                sourceSheetName: "Sheet1",
                createdCount: 1,
                restoredCount: 0,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
                ...overrides,
            },
        });
    }

    it("rejects a MemberImport with a negative skip count", async () => {
        const alliance = await makeAlliance();
        await expect(
            makeMemberImport(alliance.id, { skippedExistingCount: -1 })
        ).rejects.toThrow();
    });

    it("rejects a MemberImport with createdCount = 0 and restoredCount = 0 (zero net effect)", async () => {
        const alliance = await makeAlliance();
        await expect(
            makeMemberImport(alliance.id, { createdCount: 0, restoredCount: 0 })
        ).rejects.toThrow();
    });

    it("accepts a well-formed MemberImport with createdCount + restoredCount >= 1", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id, { createdCount: 0, restoredCount: 1 });
        expect(memberImport.id).toBeDefined();
    });

    // #277 PR 4 (#282)
    it("defaults mode to CURRENT and createdArchivedCount/skippedLifecycleConflictCount to 0 when omitted", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        expect(memberImport.mode).toBe("CURRENT");
        expect(memberImport.createdArchivedCount).toBe(0);
        expect(memberImport.skippedLifecycleConflictCount).toBe(0);
    });

    it("accepts an explicit HISTORICAL mode with a createdArchivedCount equal to createdCount", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id, {
            mode: "HISTORICAL",
            createdCount: 3,
            createdArchivedCount: 3,
        });
        expect(memberImport.mode).toBe("HISTORICAL");
        expect(memberImport.createdArchivedCount).toBe(3);
    });

    it("rejects a createdArchivedCount greater than createdCount", async () => {
        const alliance = await makeAlliance();
        await expect(
            makeMemberImport(alliance.id, { createdCount: 2, createdArchivedCount: 3 })
        ).rejects.toThrow();
    });

    it("rejects a negative createdArchivedCount", async () => {
        const alliance = await makeAlliance();
        await expect(
            makeMemberImport(alliance.id, { createdCount: 1, createdArchivedCount: -1 })
        ).rejects.toThrow();
    });

    it("rejects a negative skippedLifecycleConflictCount", async () => {
        const alliance = await makeAlliance();
        await expect(
            makeMemberImport(alliance.id, { skippedLifecycleConflictCount: -1 })
        ).rejects.toThrow();
    });

    // fileName/sourceSheetName are required (String, not String?) — the
    // Prisma client's own generated types already reject `null` for these
    // at compile time, so the only way to exercise the NOT NULL constraint
    // itself is a raw insert that bypasses the generated client's typing.
    it("rejects a MemberImport with a null fileName at the database level", async () => {
        const alliance = await makeAlliance();
        const id = `test-null-filename-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await expect(
            prisma.$executeRaw`
                INSERT INTO "MemberImport" (
                    "id", "allianceId", "actorEmailSnapshot", "fileName", "sourceSheetName",
                    "createdCount", "restoredCount", "skippedExistingCount", "skippedDuplicateCount",
                    "skippedEmptyNameCount", "skippedUnselectedCount"
                ) VALUES (
                    ${id}, ${alliance.id}, 'actor@example.test', NULL, 'Sheet1',
                    1, 0, 0, 0, 0, 0
                )
            `
        ).rejects.toThrow();
    });

    it("rejects a MemberImport with a null sourceSheetName at the database level", async () => {
        const alliance = await makeAlliance();
        const id = `test-null-sheetname-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await expect(
            prisma.$executeRaw`
                INSERT INTO "MemberImport" (
                    "id", "allianceId", "actorEmailSnapshot", "fileName", "sourceSheetName",
                    "createdCount", "restoredCount", "skippedExistingCount", "skippedDuplicateCount",
                    "skippedEmptyNameCount", "skippedUnselectedCount"
                ) VALUES (
                    ${id}, ${alliance.id}, 'actor@example.test', 'roster.xlsx', NULL,
                    1, 0, 0, 0, 0, 0
                )
            `
        ).rejects.toThrow();
    });

    it("rejects a MemberImportChange with sourceRow = 0", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        await expect(
            prisma.memberImportChange.create({
                data: {
                    memberImportId: memberImport.id,
                    playerNameSnapshot: "Player One",
                    sourceRow: 0,
                    changeType: "CREATED",
                    memberUpdatedAtAfter: new Date(),
                },
            })
        ).rejects.toThrow();
    });

    it("rejects a CREATED change carrying a non-null thpBefore", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        await expect(
            prisma.memberImportChange.create({
                data: {
                    memberImportId: memberImport.id,
                    playerNameSnapshot: "Player One",
                    sourceRow: 1,
                    changeType: "CREATED",
                    thpBefore: 100,
                    memberUpdatedAtAfter: new Date(),
                },
            })
        ).rejects.toThrow();
    });

    // #277 PR 4 (#282): relaxed from the original PR 1 constraint. A
    // historical-mode "create as archived" row is still a CREATED change —
    // the member didn't exist before this import (thpBefore/roleBefore/
    // archivedAtBefore are still all null) — it just directly records the
    // archived timestamp as its after-state instead of null.
    it("accepts a CREATED change carrying a non-null archivedAtAfter (historical direct-archived creation)", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        const change = await prisma.memberImportChange.create({
            data: {
                memberImportId: memberImport.id,
                playerNameSnapshot: "Player One",
                sourceRow: 1,
                changeType: "CREATED",
                archivedAtAfter: new Date(),
                memberUpdatedAtAfter: new Date(),
            },
        });
        expect(change.id).toBeDefined();
        expect(change.archivedAtAfter).not.toBeNull();
    });

    it("still rejects a CREATED change carrying a non-null archivedAtBefore, even with a non-null archivedAtAfter", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        await expect(
            prisma.memberImportChange.create({
                data: {
                    memberImportId: memberImport.id,
                    playerNameSnapshot: "Player One",
                    sourceRow: 1,
                    changeType: "CREATED",
                    archivedAtBefore: new Date(),
                    archivedAtAfter: new Date(),
                    memberUpdatedAtAfter: new Date(),
                },
            })
        ).rejects.toThrow();
    });

    it("rejects a RESTORED change with a null archivedAtBefore", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id, { createdCount: 0, restoredCount: 1 });
        await expect(
            prisma.memberImportChange.create({
                data: {
                    memberImportId: memberImport.id,
                    playerNameSnapshot: "Player One",
                    sourceRow: 1,
                    changeType: "RESTORED",
                    archivedAtBefore: null,
                    memberUpdatedAtAfter: new Date(),
                },
            })
        ).rejects.toThrow();
    });

    it("rejects a RESTORED change with a non-null archivedAtAfter", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id, { createdCount: 0, restoredCount: 1 });
        await expect(
            prisma.memberImportChange.create({
                data: {
                    memberImportId: memberImport.id,
                    playerNameSnapshot: "Player One",
                    sourceRow: 1,
                    changeType: "RESTORED",
                    archivedAtBefore: new Date(),
                    archivedAtAfter: new Date(),
                    memberUpdatedAtAfter: new Date(),
                },
            })
        ).rejects.toThrow();
    });

    it("accepts a well-formed CREATED change", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        const change = await prisma.memberImportChange.create({
            data: {
                memberImportId: memberImport.id,
                playerNameSnapshot: "Player One",
                sourceRow: 1,
                changeType: "CREATED",
                memberUpdatedAtAfter: new Date(),
            },
        });
        expect(change.id).toBeDefined();
    });

    it("accepts a well-formed RESTORED change", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id, { createdCount: 0, restoredCount: 1 });
        const change = await prisma.memberImportChange.create({
            data: {
                memberImportId: memberImport.id,
                playerNameSnapshot: "Player One",
                sourceRow: 1,
                changeType: "RESTORED",
                archivedAtBefore: new Date(),
                archivedAtAfter: null,
                memberUpdatedAtAfter: new Date(),
            },
        });
        expect(change.id).toBeDefined();
    });

    it("rejects two changes on the same import sharing a sourceRow", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id, { createdCount: 2 });
        await prisma.memberImportChange.create({
            data: {
                memberImportId: memberImport.id,
                playerNameSnapshot: "Player One",
                sourceRow: 1,
                changeType: "CREATED",
                memberUpdatedAtAfter: new Date(),
            },
        });

        await expect(
            prisma.memberImportChange.create({
                data: {
                    memberImportId: memberImport.id,
                    playerNameSnapshot: "Player Two",
                    sourceRow: 1,
                    changeType: "CREATED",
                    memberUpdatedAtAfter: new Date(),
                },
            })
        ).rejects.toThrow();
    });

    it("rejects deleting a MemberImport that still has MemberImportChange rows (Restrict, not Cascade)", async () => {
        const alliance = await makeAlliance();
        const memberImport = await makeMemberImport(alliance.id);
        await prisma.memberImportChange.create({
            data: {
                memberImportId: memberImport.id,
                playerNameSnapshot: "Player One",
                sourceRow: 1,
                changeType: "CREATED",
                memberUpdatedAtAfter: new Date(),
            },
        });

        await expect(prisma.memberImport.delete({ where: { id: memberImport.id } })).rejects.toThrow();
    });
});
