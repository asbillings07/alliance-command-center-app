import { describe, it, expect, vi, beforeEach } from "vitest";
import { importMembers } from "./action";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn().mockResolvedValue({
        permissions: { canImportMembers: true },
    }),
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => {
    const mockAllianceMember = {
        findMany: vi.fn(),
        count: vi.fn(),
        createMany: vi.fn(),
        update: vi.fn(),
    };

    return {
        prisma: {
            allianceMember: mockAllianceMember,
            $transaction: vi.fn((callback) => callback({ allianceMember: mockAllianceMember })),
        },
    };
});

import { prisma } from "@/app/src/lib/prisma";

const mockAllianceMember = prisma.allianceMember as unknown as {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe("importMembers", () => {
    const allianceId = "alliance-123";

    it("succeeds when 150 source rows yield fewer than 100 final active members", async () => {
        // Setup: Alliance has 50 active members
        const activeMembers = Array.from({ length: 50 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);
        mockAllianceMember.count.mockResolvedValue(50);
        mockAllianceMember.createMany.mockResolvedValue({ count: 30 });

        // Build 150 input entries:
        // - 50 existing active members (skippedExisting = 50)
        // - 30 unique new members
        // - 20 duplicate new member entries (skippedDuplicates = 20)
        // - 50 empty/whitespace names (skippedEmptyNames = 50)
        const entries = [
            ...activeMembers.map((m) => ({ playerName: m.playerName })),
            ...Array.from({ length: 30 }, (_, i) => ({ playerName: `New Member ${i + 1}`, thp: 10000 })),
            ...Array.from({ length: 20 }, () => ({ playerName: "New Member 1" })),
            ...Array.from({ length: 50 }, () => ({ playerName: "   " })),
        ];

        expect(entries.length).toBe(150);

        const result = await importMembers(allianceId, entries);

        expect(result.errors).toEqual([]);
        expect(result.created).toBe(30);
        expect(result.restored).toBe(0);
        expect(result.skippedExisting).toBe(50);
        expect(result.skippedDuplicates).toBe(20);
        expect(result.skippedEmptyNames).toBe(50);
    });

    it("does not count existing active members or duplicate rows toward new capacity limit", async () => {
        // Alliance currently has 90 active members (capacity available = 10)
        const activeMembers = Array.from({ length: 90 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);
        mockAllianceMember.count.mockResolvedValue(90);
        mockAllianceMember.createMany.mockResolvedValue({ count: 5 });

        // Input has 90 existing members + 20 duplicate lines for new members + 5 unique new members = 115 rows total
        const entries = [
            ...activeMembers.map((m) => ({ playerName: m.playerName })),
            ...Array.from({ length: 5 }, (_, i) => ({ playerName: `Brand New Member ${i + 1}` })),
            ...Array.from({ length: 20 }, () => ({ playerName: "Brand New Member 1" })),
        ];

        const result = await importMembers(allianceId, entries);

        expect(result.errors).toEqual([]);
        expect(result.created).toBe(5);
        expect(result.skippedExisting).toBe(90);
        expect(result.skippedDuplicates).toBe(20);
    });

    it("restores archived members when requested", async () => {
        const archivedMember = {
            id: "archived-1",
            playerName: "Archived Hero",
            archivedAt: new Date(),
        };

        mockAllianceMember.findMany.mockResolvedValue([archivedMember]);
        mockAllianceMember.count.mockResolvedValue(0);
        mockAllianceMember.update.mockResolvedValue({});

        const entries = [
            { playerName: "Archived Hero", thp: 50000, role: "R4", restore: true },
        ];

        const result = await importMembers(allianceId, entries);

        expect(result.errors).toEqual([]);
        expect(result.created).toBe(0);
        expect(result.restored).toBe(1);
        expect(mockAllianceMember.update).toHaveBeenCalledWith({
            where: { id: "archived-1" },
            data: {
                archivedAt: null,
                thp: 50000,
                role: "R4",
            },
        });
    });

    it("fails clearly when selecting more members than available capacity", async () => {
        // Alliance has 82 active members -> 18 capacity remaining
        const activeMembers = Array.from({ length: 82 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);

        // Attempting to create 24 new members (overflow = 6)
        const entries = Array.from({ length: 24 }, (_, i) => ({
            playerName: `New Candidate ${i + 1}`,
        }));

        const result = await importMembers(allianceId, entries);

        expect(result.created).toBe(0);
        expect(result.restored).toBe(0);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toBe(
            "Your alliance has 82 active members, so you can add 18 more. You currently have 24 members selected (24 new, 0 restored). Deselect 6 members to continue."
        );
        expect(mockAllianceMember.createMany).not.toHaveBeenCalled();
    });

    it("enforces transactional capacity and produces zero writes if count changes concurrently", async () => {
        const activeMembers = Array.from({ length: 80 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);

        // Initial check sees 80 members (capacity = 20), user tries to add 20 new
        // But inside transaction count returns 85 due to race condition
        mockAllianceMember.count.mockResolvedValue(85);

        const entries = Array.from({ length: 20 }, (_, i) => ({
            playerName: `New Candidate ${i + 1}`,
        }));

        const result = await importMembers(allianceId, entries);

        expect(result.created).toBe(0);
        expect(result.restored).toBe(0);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Your alliance has 85 active members");
        expect(mockAllianceMember.createMany).not.toHaveBeenCalled();
    });

    it("enforces technical row count ceiling of 2,000 entries", async () => {
        const entries = Array.from({ length: 2001 }, (_, i) => ({
            playerName: `Player ${i + 1}`,
        }));

        const result = await importMembers(allianceId, entries);

        expect(result.created).toBe(0);
        expect(result.errors).toEqual([
            "File exceeds maximum technical ceiling of 2,000 entries",
        ]);
        expect(mockAllianceMember.findMany).not.toHaveBeenCalled();
    });
});
