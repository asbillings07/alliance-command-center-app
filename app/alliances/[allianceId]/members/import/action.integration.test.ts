import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as ImportAction from "./action";
import type * as NewMemberAction from "../new/action";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

const provenance = { fileName: "roster.xlsx", sourceSheetName: "Roster" };

/** Adds a unique, sequential sourceRow to every entry in a raw entries array. */
function withSourceRows<T extends object>(rawEntries: T[]): (T & { sourceRow: number })[] {
    return rawEntries.map((e, i) => ({ ...e, sourceRow: i + 1 }));
}

describe.skipIf(!runDb)("importMembers [integration]", () => {
    let prisma: PrismaClient;
    let importMembers: typeof ImportAction.importMembers;
    let restoreMember: typeof NewMemberAction.restoreMember;
    const createdAllianceIds: string[] = [];

    // The MemberImport -> User FK requires a real, persisted actor (the FK
    // rejects a mocked nonexistent id). Created once and reused across every
    // test in this file; a separate throwaway user is used for the
    // durable-actor-snapshot test below, since that test deletes its actor.
    let testActor: { id: string; email: string };

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
            prisma: PrismaClient;
        });
        ({ importMembers } = await import("./action"));
        ({ restoreMember } = await import("../new/action"));

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const user = await prisma.user.create({
            data: {
                email: `integration-actor-${suffix}@test.local`,
                displayName: "Integration Test Actor",
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
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });
    });

    afterEach(async () => {
        if (createdAllianceIds.length > 0) {
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

    async function makeAllianceWithActiveMembers(activeCount: number) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const alliance = await prisma.alliance.create({
            data: {
                name: `Integration Test Alliance ${suffix}`,
                server: "1001",
            },
        });
        createdAllianceIds.push(alliance.id);

        if (activeCount > 0) {
            await prisma.allianceMember.createMany({
                data: Array.from({ length: activeCount }, (_, i) => ({
                    allianceId: alliance.id,
                    playerName: `Existing Active Member ${i + 1}`,
                })),
            });
        }

        return alliance;
    }

    it("integration: serializes two simultaneous imports so total active count never exceeds 100", async () => {
        // Alliance currently has 90 active members -> available capacity = 10
        const alliance = await makeAllianceWithActiveMembers(90);

        // Batch 1 tries to add 10 new members
        const entries1 = withSourceRows(
            Array.from({ length: 10 }, (_, i) => ({
                playerName: `Concurrent Player Batch A ${i + 1}`,
            }))
        );

        // Batch 2 tries to add 10 new members
        const entries2 = withSourceRows(
            Array.from({ length: 10 }, (_, i) => ({
                playerName: `Concurrent Player Batch B ${i + 1}`,
            }))
        );

        // Execute both import calls simultaneously against PostgreSQL
        const [res1, res2] = await Promise.all([
            importMembers(alliance.id, entries1, provenance),
            importMembers(alliance.id, entries2, provenance),
        ]);

        const successCount = [res1, res2].filter((r) => r.created === 10).length;
        const failedCount = [res1, res2].filter((r) => r.created === 0 && r.errors.length > 0).length;

        expect(successCount).toBe(1);
        expect(failedCount).toBe(1);

        const failedResult = [res1, res2].find((r) => r.created === 0)!;
        expect(failedResult.errors[0]).toContain("Your alliance has 100 active members");
        expect(failedResult.memberImportId).toBeNull();

        // Verify total active members in the database is strictly 100
        const finalActiveCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });

        expect(finalActiveCount).toBe(100);
    });

    it("integration: serializes manual restore vs roster import using shared Alliance row lock", async () => {
        // Alliance currently has 99 active members + 1 archived member
        const alliance = await makeAllianceWithActiveMembers(99);
        const archivedMember = await prisma.allianceMember.create({
            data: {
                allianceId: alliance.id,
                playerName: "Archived Hero",
                archivedAt: new Date(),
            },
        });

        // Batch tries to import 1 new member
        const entries = withSourceRows([{ playerName: "New Candidate Player" }]);

        // FormData for manual restore
        const formData = new FormData();
        formData.append("allianceId", alliance.id);
        formData.append("memberId", archivedMember.id);

        // Run manual restore and import concurrently
        const [restoreRes, importRes] = await Promise.all([
            restoreMember(formData),
            importMembers(alliance.id, entries, provenance),
        ]);

        // Exactly one can succeed because capacity is 1
        const restoreSuccess = restoreRes.success;
        const importSuccess = importRes.created === 1;

        expect(restoreSuccess !== importSuccess).toBe(true); // One succeeded, one failed

        // Final count in DB must be exactly 100 (never 101)
        const finalCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });

        expect(finalCount).toBe(100);
    });

    it("integration: rejects import and creates 0 members when user lacks canImportMembers permission", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);

        vi.mocked(requireAllianceAccess).mockRejectedValueOnce(
            new Error("Forbidden: Missing required permission canImportMembers")
        );

        const entries = withSourceRows([{ playerName: "Unauthorized Candidate" }]);
        await expect(importMembers(alliance.id, entries, provenance)).rejects.toThrow(
            "Forbidden: Missing required permission canImportMembers"
        );

        const memberCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id },
        });
        expect(memberCount).toBe(0);

        const importCount = await prisma.memberImport.count({ where: { allianceId: alliance.id } });
        expect(importCount).toBe(0);
    });

    it("integration: persists localized THP string strictly into PostgreSQL (450.000.000 -> 450000000)", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);

        const res = await importMembers(
            alliance.id,
            withSourceRows([{ playerName: "Localized THP Player", thp: "450.000.000" }]),
            provenance
        );

        expect(res.created).toBe(1);
        expect(res.errors).toHaveLength(0);

        const createdMember = await prisma.allianceMember.findFirst({
            where: { allianceId: alliance.id, playerName: "Localized THP Player" },
        });

        expect(createdMember).not.toBeNull();
        expect(createdMember?.thp).toBe(450000000);
    });

    it("integration: performs zero database writes when raw THP is malformed (450.5), out-of-range (2147483648), or negative (-100)", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);

        const res1 = await importMembers(
            alliance.id,
            withSourceRows([{ playerName: "Malformed THP Player", thp: "450.5" }]),
            provenance
        );
        expect(res1.created).toBe(0);
        expect(res1.errors.length).toBeGreaterThan(0);

        const res2 = await importMembers(
            alliance.id,
            withSourceRows([{ playerName: "Negative THP Player", thp: "-100" }]),
            provenance
        );
        expect(res2.created).toBe(0);
        expect(res2.errors.length).toBeGreaterThan(0);

        const res3 = await importMembers(
            alliance.id,
            withSourceRows([{ playerName: "Overflow THP Player", thp: "2147483648" }]),
            provenance
        );
        expect(res3.created).toBe(0);
        expect(res3.errors.length).toBeGreaterThan(0);

        const count = await prisma.allianceMember.count({
            where: { allianceId: alliance.id },
        });
        expect(count).toBe(0);
    });

    describe("import history provenance", () => {
        it("persists a MemberImport with full after-state MemberImportChange rows and returns memberImportId", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);

            const res = await importMembers(
                alliance.id,
                withSourceRows([
                    { playerName: "New Provenance Player", thp: "50000", role: "R4" },
                ]),
                { fileName: "roster-2026-08.xlsx", sourceSheetName: "August Roster" }
            );

            expect(res.created).toBe(1);
            expect(res.memberImportId).not.toBeNull();

            const memberImport = await prisma.memberImport.findUnique({
                where: { id: res.memberImportId! },
                include: { changes: true },
            });

            expect(memberImport).not.toBeNull();
            expect(memberImport?.allianceId).toBe(alliance.id);
            expect(memberImport?.fileName).toBe("roster-2026-08.xlsx");
            expect(memberImport?.sourceSheetName).toBe("August Roster");
            expect(memberImport?.actorUserId).toBe(testActor.id);
            expect(memberImport?.actorEmailSnapshot).toBe(testActor.email);
            expect(memberImport?.createdCount).toBe(1);
            expect(memberImport?.restoredCount).toBe(0);
            expect(memberImport?.changes).toHaveLength(1);

            const change = memberImport!.changes[0];
            expect(change.changeType).toBe("CREATED");
            expect(change.playerNameSnapshot).toBe("New Provenance Player");
            expect(change.sourceRow).toBe(1);
            expect(change.thpBefore).toBeNull();
            expect(change.thpAfter).toBe(50000);
            expect(change.roleBefore).toBeNull();
            expect(change.roleAfter).toBe("R4");
            expect(change.archivedAtBefore).toBeNull();
            expect(change.archivedAtAfter).toBeNull();
            // Full post-import scalar snapshot, beyond thp/role: this import
            // workflow never touches discordName/squadPower/joinedAt/userId,
            // so they should be captured as null, not omitted.
            expect(change.discordNameAfter).toBeNull();
            expect(change.squadPowerAfter).toBeNull();
            expect(change.joinedAtAfter).toBeNull();
            expect(change.userIdAfter).toBeNull();
            expect(change.memberUpdatedAtAfter).toBeInstanceOf(Date);

            const createdMember = await prisma.allianceMember.findFirst({
                where: { allianceId: alliance.id, playerName: "New Provenance Player" },
            });
            expect(change.allianceMemberId).toBe(createdMember!.id);
        });

        it("persists a RESTORED change with a real before-snapshot", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);
            const archivedMember = await prisma.allianceMember.create({
                data: {
                    allianceId: alliance.id,
                    playerName: "Restorable Hero",
                    thp: 10000,
                    role: "R2",
                    archivedAt: new Date(),
                },
            });

            const res = await importMembers(
                alliance.id,
                withSourceRows([
                    { playerName: "Restorable Hero", thp: "20000", role: "R3", restore: true },
                ]),
                provenance
            );

            expect(res.restored).toBe(1);
            expect(res.memberImportId).not.toBeNull();

            const change = await prisma.memberImportChange.findFirst({
                where: { memberImportId: res.memberImportId!, allianceMemberId: archivedMember.id },
            });

            expect(change).not.toBeNull();
            expect(change?.changeType).toBe("RESTORED");
            expect(change?.thpBefore).toBe(10000);
            expect(change?.thpAfter).toBe(20000);
            expect(change?.roleBefore).toBe("R2");
            expect(change?.roleAfter).toBe("R3");
            expect(change?.archivedAtBefore).not.toBeNull();
            expect(change?.archivedAtAfter).toBeNull();
        });

        it("does not create a MemberImport row when the commit has zero net effect (everything skipped)", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);
            await prisma.allianceMember.create({
                data: { allianceId: alliance.id, playerName: "Already Active Member" },
            });

            const res = await importMembers(
                alliance.id,
                withSourceRows([{ playerName: "Already Active Member" }]),
                provenance
            );

            expect(res.created).toBe(0);
            expect(res.restored).toBe(0);
            expect(res.skippedExisting).toBe(1);
            expect(res.memberImportId).toBeNull();

            const importCount = await prisma.memberImport.count({ where: { allianceId: alliance.id } });
            expect(importCount).toBe(0);
        });

        it("does not create a MemberImport row when the domain capacity check fails", async () => {
            const alliance = await makeAllianceWithActiveMembers(100);

            const res = await importMembers(
                alliance.id,
                withSourceRows([{ playerName: "Overflow Candidate" }]),
                provenance
            );

            expect(res.created).toBe(0);
            expect(res.memberImportId).toBeNull();

            const importCount = await prisma.memberImport.count({ where: { allianceId: alliance.id } });
            expect(importCount).toBe(0);
        });

        it("rejects a duplicate submitted sourceRow before any database write", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);

            const res = await importMembers(
                alliance.id,
                [
                    { playerName: "Player One", sourceRow: 1 },
                    { playerName: "Player Two", sourceRow: 1 },
                ],
                provenance
            );

            expect(res.created).toBe(0);
            expect(res.errors[0]).toContain("Duplicate source row 1");

            const memberCount = await prisma.allianceMember.count({ where: { allianceId: alliance.id } });
            expect(memberCount).toBe(0);
        });

        it("keeps the actor snapshot durable after the actor's User row is deleted", async () => {
            const alliance = await makeAllianceWithActiveMembers(0);
            const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const throwawayActor = await prisma.user.create({
                data: {
                    email: `throwaway-actor-${suffix}@test.local`,
                    displayName: "Throwaway Actor",
                },
            });

            vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
                user: { id: throwawayActor.id, email: throwawayActor.email },
                permissions: { canImportMembers: true } as unknown as Awaited<
                    ReturnType<typeof requireAllianceAccess>
                >["permissions"],
                membership: {} as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
            });

            const res = await importMembers(
                alliance.id,
                withSourceRows([{ playerName: "Durable Snapshot Player" }]),
                provenance
            );
            expect(res.memberImportId).not.toBeNull();

            await prisma.user.delete({ where: { id: throwawayActor.id } });

            const memberImport = await prisma.memberImport.findUnique({
                where: { id: res.memberImportId! },
            });

            expect(memberImport).not.toBeNull();
            expect(memberImport?.actorUserId).toBeNull();
            expect(memberImport?.actorEmailSnapshot).toBe(throwawayActor.email);
            expect(memberImport?.actorDisplayNameSnapshot).toBe("Throwaway Actor");
        });
    });
});
