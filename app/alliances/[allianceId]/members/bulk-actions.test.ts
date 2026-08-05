import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/cache/revalidateAllianceData", () => ({
    revalidateAllianceData: vi.fn(),
}));

vi.mock("@/app/src/lib/touchAllianceSetupActivity", () => ({
    touchAllianceSetupActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/src/lib/allianceMemberLock", () => ({
    withAllianceMemberLock: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
    prisma: {
        allianceMember: {
            findMany: vi.fn(),
            updateMany: vi.fn(),
        },
        $transaction: vi.fn(),
    },
}));

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { prisma } from "@/app/src/lib/prisma";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { bulkArchiveMembers, bulkRestoreMembers } from "./bulk-actions";

const mockFindMany = prisma.allianceMember.findMany as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.allianceMember.updateMany as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockWithLock = withAllianceMemberLock as ReturnType<typeof vi.fn>;

const allianceId = "alliance-1";

function buildFormData(allianceId: string, memberIds: string[]): FormData {
    const formData = new FormData();
    formData.set("allianceId", allianceId);
    for (const id of memberIds) {
        formData.append("memberId", id);
    }
    return formData;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue({
        permissions: { canManageMembers: true },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
});

describe("bulkArchiveMembers", () => {
    it("returns an error and performs no writes when no members are selected", async () => {
        const result = await bulkArchiveMembers(buildFormData(allianceId, []));

        expect(result).toEqual({ success: false, error: "No members selected" });
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it("denies the request server-side when the caller lacks canManageMembers, regardless of client state", async () => {
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            permissions: { canManageMembers: false },
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

        const result = await bulkArchiveMembers(buildFormData(allianceId, ["m1"]));

        expect(result).toEqual({
            success: false,
            error: "You don't have permission to archive members",
        });
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it("archives every still-active selected member and revalidates members/reports", async () => {
        mockFindMany.mockResolvedValue([
            { id: "m1", archivedAt: null },
            { id: "m2", archivedAt: null },
        ]);

        const result = await bulkArchiveMembers(buildFormData(allianceId, ["m1", "m2"]));

        expect(result).toEqual({ success: true, archivedCount: 2, skippedCount: 0 });
        expect(mockUpdateMany).toHaveBeenCalledWith({
            where: { id: { in: ["m1", "m2"] } },
            data: { archivedAt: expect.any(Date) },
        });
        expect(revalidateAllianceData).toHaveBeenCalledWith({
            allianceId,
            domains: ["members", "reports"],
        });
    });

    it("skips members that are already archived (stale selection) without failing the request", async () => {
        mockFindMany.mockResolvedValue([
            { id: "m1", archivedAt: null },
            { id: "m2", archivedAt: new Date() },
        ]);

        const result = await bulkArchiveMembers(buildFormData(allianceId, ["m1", "m2"]));

        expect(result).toEqual({ success: true, archivedCount: 1, skippedCount: 1 });
        expect(mockUpdateMany).toHaveBeenCalledWith({
            where: { id: { in: ["m1"] } },
            data: { archivedAt: expect.any(Date) },
        });
    });

    it("silently excludes ids that don't resolve under this alliance (cross-tenant or stale) as skipped, without writing", async () => {
        // Only one of the two requested ids actually matched the tenant-scoped query.
        mockFindMany.mockResolvedValue([{ id: "m1", archivedAt: null }]);

        const result = await bulkArchiveMembers(buildFormData(allianceId, ["m1", "not-in-this-alliance"]));

        expect(result).toEqual({ success: true, archivedCount: 1, skippedCount: 1 });
    });

    it("performs no write at all when every selected member is already archived", async () => {
        mockFindMany.mockResolvedValue([{ id: "m1", archivedAt: new Date() }]);

        const result = await bulkArchiveMembers(buildFormData(allianceId, ["m1"]));

        expect(result).toEqual({ success: true, archivedCount: 0, skippedCount: 1 });
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });
});

describe("bulkRestoreMembers", () => {
    it("returns an error and performs no writes when no members are selected", async () => {
        const result = await bulkRestoreMembers(buildFormData(allianceId, []));

        expect(result).toEqual({ success: false, error: "No members selected" });
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it("denies the request server-side when the caller lacks canManageMembers", async () => {
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            permissions: { canManageMembers: false },
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

        const result = await bulkRestoreMembers(buildFormData(allianceId, ["m1"]));

        expect(result).toEqual({
            success: false,
            error: "You don't have permission to restore members",
        });
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it("restores every still-archived selected member when capacity allows, and revalidates members/reports", async () => {
        mockWithLock.mockImplementation(
            async (_allianceId: string, fn: (tx: typeof prisma, count: number) => unknown) => fn(prisma, 90)
        );
        mockFindMany.mockResolvedValue([
            { id: "m1", archivedAt: new Date() },
            { id: "m2", archivedAt: new Date() },
        ]);

        const result = await bulkRestoreMembers(buildFormData(allianceId, ["m1", "m2"]));

        expect(result).toEqual({ success: true, restoredCount: 2, skippedCount: 0 });
        expect(mockUpdateMany).toHaveBeenCalledWith({
            where: { id: { in: ["m1", "m2"] } },
            data: { archivedAt: null },
        });
    });

    it("skips members already restored by someone else (stale selection) without counting them against capacity", async () => {
        // Only 1 of the 2 spaces remain, but only 1 of the 2 selected members
        // is still actually archived — the already-active one needs no new
        // capacity, so the restore should proceed for the one that matters.
        mockWithLock.mockImplementation(
            async (_allianceId: string, fn: (tx: typeof prisma, count: number) => unknown) => fn(prisma, 99)
        );
        mockFindMany.mockResolvedValue([
            { id: "m1", archivedAt: null }, // already restored by someone else
            { id: "m2", archivedAt: new Date() },
        ]);

        const result = await bulkRestoreMembers(buildFormData(allianceId, ["m1", "m2"]));

        expect(result).toEqual({ success: true, restoredCount: 1, skippedCount: 1 });
        expect(mockUpdateMany).toHaveBeenCalledWith({
            where: { id: { in: ["m2"] } },
            data: { archivedAt: null },
        });
    });

    it("rejects the entire restore atomically when the still-archived selection exceeds capacity, restoring nobody", async () => {
        // 5 selected, all still archived, but only 3 spaces remain.
        mockWithLock.mockImplementation(
            async (_allianceId: string, fn: (tx: typeof prisma, count: number) => unknown) => fn(prisma, 97)
        );
        mockFindMany.mockResolvedValue(
            ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id, archivedAt: new Date() }))
        );

        const result = await bulkRestoreMembers(buildFormData(allianceId, ["m1", "m2", "m3", "m4", "m5"]));

        expect(result).toEqual({
            success: false,
            error:
                "Your alliance has 97 active members, so you can restore 3 more. " +
                "You currently have 5 members selected. " +
                "Deselect 2 members to continue.",
        });
        expect(mockUpdateMany).not.toHaveBeenCalled();
        expect(revalidateAllianceData).not.toHaveBeenCalled();
    });
});
