import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
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

describe.skipIf(!runDb)("importMembers [integration]", () => {
    let prisma: PrismaClient;
    let importMembers: typeof ImportAction.importMembers;
    let restoreMember: typeof NewMemberAction.restoreMember;
    const createdAllianceIds: string[] = [];

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
            prisma: PrismaClient;
        });
        ({ importMembers } = await import("./action"));
        ({ restoreMember } = await import("../new/action"));
    });

    beforeEach(() => {
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            user: { id: "integration-test-user", email: "test@local" },
            permissions: {
                canManageMembers: true,
                canImportMembers: true,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });
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
        const entries1 = Array.from({ length: 10 }, (_, i) => ({
            playerName: `Concurrent Player Batch A ${i + 1}`,
        }));

        // Batch 2 tries to add 10 new members
        const entries2 = Array.from({ length: 10 }, (_, i) => ({
            playerName: `Concurrent Player Batch B ${i + 1}`,
        }));

        // Execute both import calls simultaneously against PostgreSQL
        const [res1, res2] = await Promise.all([
            importMembers(alliance.id, entries1),
            importMembers(alliance.id, entries2),
        ]);

        const successCount = [res1, res2].filter((r) => r.created === 10).length;
        const failedCount = [res1, res2].filter((r) => r.created === 0 && r.errors.length > 0).length;

        expect(successCount).toBe(1);
        expect(failedCount).toBe(1);

        const failedResult = [res1, res2].find((r) => r.created === 0)!;
        expect(failedResult.errors[0]).toContain("Your alliance has 100 active members");

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
        const entries = [{ playerName: "New Candidate Player" }];

        // FormData for manual restore
        const formData = new FormData();
        formData.append("allianceId", alliance.id);
        formData.append("memberId", archivedMember.id);

        // Run manual restore and import concurrently
        const [restoreRes, importRes] = await Promise.all([
            restoreMember(formData),
            importMembers(alliance.id, entries),
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

        const entries = [{ playerName: "Unauthorized Candidate" }];
        await expect(importMembers(alliance.id, entries)).rejects.toThrow(
            "Forbidden: Missing required permission canImportMembers"
        );

        const memberCount = await prisma.allianceMember.count({
            where: { allianceId: alliance.id },
        });
        expect(memberCount).toBe(0);
    });

    it("integration: persists localized THP string strictly into PostgreSQL (450.000.000 -> 450000000)", async () => {
        const alliance = await makeAllianceWithActiveMembers(0);

        const res = await importMembers(alliance.id, [
            { playerName: "Localized THP Player", thp: "450.000.000" },
        ]);

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

        const res1 = await importMembers(alliance.id, [
            { playerName: "Malformed THP Player", thp: "450.5" },
        ]);
        expect(res1.created).toBe(0);
        expect(res1.errors.length).toBeGreaterThan(0);

        const res2 = await importMembers(alliance.id, [
            { playerName: "Negative THP Player", thp: "-100" },
        ]);
        expect(res2.created).toBe(0);
        expect(res2.errors.length).toBeGreaterThan(0);

        const res3 = await importMembers(alliance.id, [
            { playerName: "Overflow THP Player", thp: "2147483648" },
        ]);
        expect(res3.created).toBe(0);
        expect(res3.errors.length).toBeGreaterThan(0);

        const count = await prisma.allianceMember.count({
            where: { allianceId: alliance.id },
        });
        expect(count).toBe(0);
    });
});
