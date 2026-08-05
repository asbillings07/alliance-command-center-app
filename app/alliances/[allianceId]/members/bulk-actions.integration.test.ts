import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as BulkActions from "./bulk-actions";
import type * as NewMemberAction from "./new/action";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("bulkArchiveMembers / bulkRestoreMembers [integration]", () => {
    let prisma: PrismaClient;
    let bulkArchiveMembers: typeof BulkActions.bulkArchiveMembers;
    let bulkRestoreMembers: typeof BulkActions.bulkRestoreMembers;
    let restoreMember: typeof NewMemberAction.restoreMember;
    const createdAllianceIds: string[] = [];

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
            prisma: PrismaClient;
        });
        ({ bulkArchiveMembers, bulkRestoreMembers } = await import("./bulk-actions"));
        ({ restoreMember } = await import("./new/action"));

        vi.mocked(requireAllianceAccess).mockResolvedValue({
            permissions: { canManageMembers: true } as unknown as Awaited<
                ReturnType<typeof requireAllianceAccess>
            >["permissions"],
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    });

    afterEach(async () => {
        if (createdAllianceIds.length > 0) {
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
            data: { name: `Bulk Actions Integration Alliance ${suffix}`, server: "1001" },
        });
        createdAllianceIds.push(alliance.id);
        return alliance;
    }

    async function seedActiveMembers(allianceId: string, count: number) {
        if (count === 0) return;
        await prisma.allianceMember.createMany({
            data: Array.from({ length: count }, (_, i) => ({
                allianceId,
                playerName: `Active Member ${i + 1}`,
            })),
        });
    }

    async function seedArchivedMembers(allianceId: string, count: number, namePrefix = "Archived Member") {
        return Promise.all(
            Array.from({ length: count }, (_, i) =>
                prisma.allianceMember.create({
                    data: {
                        allianceId,
                        playerName: `${namePrefix} ${i + 1}`,
                        archivedAt: new Date(),
                    },
                })
            )
        );
    }

    function buildFormData(allianceId: string, memberIds: string[]): FormData {
        const formData = new FormData();
        formData.set("allianceId", allianceId);
        for (const id of memberIds) {
            formData.append("memberId", id);
        }
        return formData;
    }

    it("integration: bulk-archives a real active roster and later bulk-restores it, round-tripping archivedAt", async () => {
        const alliance = await makeAlliance();
        await seedActiveMembers(alliance.id, 3);
        const members = await prisma.allianceMember.findMany({ where: { allianceId: alliance.id } });
        const memberIds = members.map((m) => m.id);

        const archiveResult = await bulkArchiveMembers(buildFormData(alliance.id, memberIds));
        expect(archiveResult).toMatchObject({ success: true, archivedCount: 3, skippedCount: 0 });

        const afterArchive = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(afterArchive).toBe(0);

        const restoreResult = await bulkRestoreMembers(buildFormData(alliance.id, memberIds));
        expect(restoreResult).toMatchObject({ success: true, restoredCount: 3, skippedCount: 0 });

        const afterRestore = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(afterRestore).toBe(3);
    });

    it("integration: two concurrent bulk archives racing for the same member count it as archived exactly once, never twice", async () => {
        // bulkArchiveMembers holds no alliance-level lock (archive doesn't
        // need one — it never checks capacity), so this exercises the
        // updateMany's own `archivedAt: null` WHERE condition as the actual
        // concurrency guard: whichever transaction's UPDATE commits first
        // wins the row; the loser's UPDATE re-evaluates its WHERE against
        // the now-committed row and simply doesn't match it.
        const alliance = await makeAlliance();
        const [contested] = await Promise.all([
            prisma.allianceMember.create({
                data: { allianceId: alliance.id, playerName: "Contested Member" },
            }),
        ]);

        const [resA, resB] = await Promise.all([
            bulkArchiveMembers(buildFormData(alliance.id, [contested.id])),
            bulkArchiveMembers(buildFormData(alliance.id, [contested.id])),
        ]);

        if (!resA.success || !resB.success) throw new Error("expected both calls to succeed (as no-ops or real archives)");

        // The row was archived exactly once in aggregate — never double-counted
        // and never left un-archived.
        expect(resA.archivedCount + resB.archivedCount).toBe(1);
        expect(resA.skippedCount + resB.skippedCount).toBe(1);

        const final = await prisma.allianceMember.findUniqueOrThrow({ where: { id: contested.id } });
        expect(final.archivedAt).not.toBeNull();
    });

    it("integration: rejects a bulk restore atomically when capacity is insufficient, leaving the database completely untouched", async () => {
        // 97 active + 5 archived -> only 3 spaces remain for a 5-member restore.
        const alliance = await makeAlliance();
        await seedActiveMembers(alliance.id, 97);
        const archived = await seedArchivedMembers(alliance.id, 5);

        const result = await bulkRestoreMembers(buildFormData(alliance.id, archived.map((m) => m.id)));

        expect(result).toMatchObject({ success: false });
        if (result.success) throw new Error("expected failure");
        expect(result.error).toContain("Your alliance has 97 active members");

        // No partial restore — every one of the 5 selected members is still archived.
        const stillArchivedCount = await prisma.allianceMember.count({
            where: { id: { in: archived.map((m) => m.id) }, archivedAt: { not: null } },
        });
        expect(stillArchivedCount).toBe(5);

        const activeCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(activeCount).toBe(97);
    });

    it("integration: serializes two concurrent bulk restores on the same alliance so total active count never exceeds the cap", async () => {
        // 90 active -> 10 spaces remain. Two batches of 6 archived members
        // each race for those 10 spaces; exactly one batch's full 6 should
        // fit, or capacity is split — either way the total must stay <= 100
        // and no batch may partially restore.
        const alliance = await makeAlliance();
        await seedActiveMembers(alliance.id, 90);
        const batchA = await seedArchivedMembers(alliance.id, 6, "Batch A Archived Member");
        const batchB = await seedArchivedMembers(alliance.id, 6, "Batch B Archived Member");

        const [resA, resB] = await Promise.all([
            bulkRestoreMembers(buildFormData(alliance.id, batchA.map((m) => m.id))),
            bulkRestoreMembers(buildFormData(alliance.id, batchB.map((m) => m.id))),
        ]);

        const successCount = [resA, resB].filter((r) => r.success).length;
        const failureCount = [resA, resB].filter((r) => !r.success).length;
        expect(successCount).toBe(1);
        expect(failureCount).toBe(1);

        const finalActiveCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(finalActiveCount).toBe(96); // 90 + exactly one full batch of 6, never a partial mix

        const failed = [resA, resB].find((r) => !r.success)!;
        if (failed.success) throw new Error("expected failure");
        expect(failed.error).toContain("Your alliance has 96 active members");
    });

    it("integration: serializes a bulk restore against a concurrent single-member restore via the same shared Alliance row lock", async () => {
        // 99 active + 1 archived (single) + 1 archived (bulk target) -> only 1 space remains.
        const alliance = await makeAlliance();
        await seedActiveMembers(alliance.id, 99);
        const [singleTarget, bulkTarget] = await seedArchivedMembers(alliance.id, 2);

        const singleFormData = new FormData();
        singleFormData.append("allianceId", alliance.id);
        singleFormData.append("memberId", singleTarget.id);

        const [singleResult, bulkResult] = await Promise.all([
            restoreMember(singleFormData),
            bulkRestoreMembers(buildFormData(alliance.id, [bulkTarget.id])),
        ]);

        const singleSucceeded = singleResult.success;
        const bulkSucceeded = bulkResult.success;
        expect(singleSucceeded !== bulkSucceeded).toBe(true); // exactly one succeeded

        const finalActiveCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(finalActiveCount).toBe(100);
    });

    it("integration: skips a member restored by someone else moments before the bulk submit, without letting it consume capacity", async () => {
        // 98 active + 2 archived selected for bulk restore, but one of the
        // two was already restored (by a concurrent single action) before
        // the bulk transaction's lock is acquired.
        const alliance = await makeAlliance();
        await seedActiveMembers(alliance.id, 98);
        const [alreadyRestored, stillArchived] = await seedArchivedMembers(alliance.id, 2);

        // Simulate the race deterministically: restore one member first,
        // then submit the bulk restore against the original two-member
        // selection (as the UI would have captured it before that happened).
        await prisma.allianceMember.update({
            where: { id: alreadyRestored.id },
            data: { archivedAt: null },
        });

        const result = await bulkRestoreMembers(
            buildFormData(alliance.id, [alreadyRestored.id, stillArchived.id])
        );

        expect(result).toMatchObject({ success: true, restoredCount: 1, skippedCount: 1 });

        const finalActiveCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id, archivedAt: null },
        });
        expect(finalActiveCount).toBe(100);
    });
});
