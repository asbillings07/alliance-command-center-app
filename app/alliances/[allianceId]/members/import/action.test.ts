import { describe, it, expect, vi, beforeEach } from "vitest";
import { importMembers } from "./action";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn().mockResolvedValue({
        user: { id: "actor-user-1", email: "session-actor@example.com" },
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
        // Realistic default: mirrors createManyAndReturn's real behavior by
        // returning one row per requested entry, so `created` naturally
        // equals the number of entries classified as new (no createMany
        // count field to keep synchronized with the classification logic).
        createManyAndReturn: vi.fn(
            async ({ data }: { data: Array<{ playerName: string; thp: number | null; role: string | null }> }) =>
                data.map((d, i) => ({
                    id: `created-${i}`,
                    playerName: d.playerName,
                    thp: d.thp,
                    role: d.role,
                    archivedAt: null,
                    discordName: null,
                    squadPower: null,
                    joinedAt: null,
                    userId: null,
                    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
                }))
        ),
        update: vi.fn(
            async ({ data }: { data: { thp?: number; role?: string } }) => ({
                id: "restored-1",
                playerName: "Restored Member",
                thp: data.thp ?? null,
                role: data.role ?? null,
                archivedAt: null,
                discordName: null,
                squadPower: null,
                joinedAt: null,
                userId: null,
                updatedAt: new Date("2024-01-01T00:00:00.000Z"),
            })
        ),
    };

    const mockUser = {
        findUnique: vi.fn().mockResolvedValue({ email: "actor@example.com", displayName: "Test Actor" }),
    };

    const mockMemberImport = {
        create: vi.fn().mockResolvedValue({ id: "import-1" }),
    };

    const mockTx = {
        allianceMember: mockAllianceMember,
        user: mockUser,
        memberImport: mockMemberImport,
        $executeRaw: vi.fn().mockResolvedValue(1),
    };

    return {
        prisma: {
            allianceMember: mockAllianceMember,
            user: mockUser,
            memberImport: mockMemberImport,
            $executeRaw: vi.fn().mockResolvedValue(1),
            $transaction: vi.fn((callback) => callback(mockTx)),
        },
    };
});

import { prisma } from "@/app/src/lib/prisma";

const mockAllianceMember = prisma.allianceMember as unknown as {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    createManyAndReturn: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
};

const mockMemberImport = prisma.memberImport as unknown as {
    create: ReturnType<typeof vi.fn>;
};

const mockUser = prisma.user as unknown as {
    findUnique: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    vi.clearAllMocks();
    mockUser.findUnique.mockResolvedValue({ email: "actor@example.com", displayName: "Test Actor" });
    mockMemberImport.create.mockResolvedValue({ id: "import-1" });
});

/** Adds a unique, sequential sourceRow to every entry in a raw entries array. */
function withSourceRows<T extends object>(rawEntries: T[]): (T & { sourceRow: number })[] {
    return rawEntries.map((e, i) => ({ ...e, sourceRow: i + 1 }));
}

const provenance = { fileName: "roster.xlsx", sourceSheetName: "Sheet1" };

describe("importMembers", () => {
    const allianceId = "alliance-123";

    it("succeeds when 150 source rows yield fewer than 100 final active members", async () => {
        // Setup: Alliance has 50 active members
        const activeMembers = Array.from({ length: 50 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
            thp: null,
            role: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);
        mockAllianceMember.count.mockResolvedValue(50);

        // Build 150 input entries:
        // - 50 existing active members (skippedExisting = 50)
        // - 30 unique new members
        // - 20 duplicate new member entries (skippedDuplicates = 20)
        // - 50 empty/whitespace names (skippedEmptyNames = 50)
        const entries = withSourceRows([
            ...activeMembers.map((m) => ({ playerName: m.playerName })),
            ...Array.from({ length: 30 }, (_, i) => ({ playerName: `New Member ${i + 1}`, thp: "10000" })),
            ...Array.from({ length: 20 }, () => ({ playerName: "New Member 1" })),
            ...Array.from({ length: 50 }, () => ({ playerName: "   " })),
        ]);

        expect(entries.length).toBe(150);

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.errors).toEqual([]);
        expect(result.created).toBe(30);
        expect(result.restored).toBe(0);
        expect(result.skippedExisting).toBe(50);
        expect(result.skippedDuplicates).toBe(20);
        expect(result.skippedEmptyNames).toBe(50);
        expect(result.memberImportId).toBe("import-1");
        expect(mockMemberImport.create).toHaveBeenCalledTimes(1);
    });

    it("does not count existing active members or duplicate rows toward new capacity limit", async () => {
        // Alliance currently has 90 active members (capacity available = 10)
        const activeMembers = Array.from({ length: 90 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
            thp: null,
            role: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);
        mockAllianceMember.count.mockResolvedValue(90);

        // Input has 90 existing members + 20 duplicate lines for new members + 5 unique new members = 115 rows total
        const entries = withSourceRows([
            ...activeMembers.map((m) => ({ playerName: m.playerName })),
            ...Array.from({ length: 5 }, (_, i) => ({ playerName: `Brand New Member ${i + 1}` })),
            ...Array.from({ length: 20 }, () => ({ playerName: "Brand New Member 1" })),
        ]);

        const result = await importMembers(allianceId, entries, provenance);

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
            thp: 40000,
            role: "R3",
        };

        mockAllianceMember.findMany.mockResolvedValue([archivedMember]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Archived Hero", thp: "50000", role: "R4", restore: true },
        ]);

        const result = await importMembers(allianceId, entries, provenance);

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
        expect(result.memberImportId).toBe("import-1");
    });

    it("fails clearly when selecting more members than available capacity", async () => {
        // Alliance has 82 active members -> 18 capacity remaining
        const activeMembers = Array.from({ length: 82 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
            thp: null,
            role: null,
        }));

        mockAllianceMember.findMany.mockResolvedValue(activeMembers);
        mockAllianceMember.count.mockResolvedValue(82);

        // Attempting to create 24 new members (overflow = 6)
        const entries = Array.from({ length: 24 }, (_, i) => ({
            playerName: `New Candidate ${i + 1}`,
            sourceRow: i + 1,
        }));

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.created).toBe(0);
        expect(result.restored).toBe(0);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Your alliance has 82 active members, so you can add 18 more");
        expect(result.errors[0]).toContain("Deselect 6 members to continue");
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
        expect(result.memberImportId).toBeNull();
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("enforces transactional capacity and produces zero writes if count changes concurrently", async () => {
        const activeMembers85 = Array.from({ length: 85 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
            thp: null,
            role: null,
        }));

        // Inside locked transaction, count returns 85 active members due to another transaction having committed
        mockAllianceMember.findMany.mockResolvedValue(activeMembers85);
        mockAllianceMember.count.mockResolvedValue(85);

        const entries = Array.from({ length: 20 }, (_, i) => ({
            playerName: `New Candidate ${i + 1}`,
            sourceRow: i + 1,
        }));

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.created).toBe(0);
        expect(result.restored).toBe(0);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Your alliance has 85 active members");
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
    });

    it("accurately tracks unselected members and skips them during import", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);

        const entries = withSourceRows([
            { playerName: "Selected Member 1", selected: true },
            { playerName: "Selected Member 2", selected: true },
            { playerName: "Unselected Member 1", selected: false },
            { playerName: "Unselected Member 2", selected: false },
        ]);

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.errors).toEqual([]);
        expect(result.created).toBe(2);
        expect(result.skippedUnselected).toBe(2);
    });

    it("enforces technical row count ceiling of 2,000 entries", async () => {
        const entries = Array.from({ length: 2001 }, (_, i) => ({
            playerName: `Player ${i + 1}`,
            sourceRow: i + 1,
        }));

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.created).toBe(0);
        expect(result.errors).toEqual([
            "File exceeds maximum technical ceiling of 2,000 entries",
        ]);
        expect(mockAllianceMember.findMany).not.toHaveBeenCalled();
    });

    it("correctly classifies repeated active members in CSV as 1 existing and subsequent occurrences as duplicates", async () => {
        mockAllianceMember.findMany.mockResolvedValue([
            { id: "active-1", playerName: "Existing Active One", archivedAt: null, thp: null, role: null },
        ]);

        const entries = withSourceRows([
            { playerName: "Existing Active One" },
            { playerName: "Existing Active One" }, // Duplicate in CSV of active member
            { playerName: "Brand New Player" },
        ]);

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.errors).toEqual([]);
        expect(result.created).toBe(1);
        expect(result.skippedExisting).toBe(1);
        expect(result.skippedDuplicates).toBe(1);
    });

    it("rejects non-string THP provided at runtime to enforce raw-string boundary", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);

        const entries = withSourceRows([
            { playerName: "Bypassing Player", thp: 10000 as unknown as string },
        ]);

        const result = await importMembers(allianceId, entries, provenance);

        expect(result.created).toBe(0);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("THP must be provided as a raw string");
    });

    describe("provenance metadata validation", () => {
        it("rejects a missing file name", async () => {
            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(allianceId, entries, { fileName: "  ", sourceSheetName: "Sheet1" });

            expect(result.errors).toEqual(["Missing or invalid file name"]);
            expect(result.memberImportId).toBeNull();
        });

        it("rejects a file name over 255 characters", async () => {
            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(allianceId, entries, {
                fileName: "a".repeat(256),
                sourceSheetName: "Sheet1",
            });

            expect(result.errors).toEqual(["Missing or invalid file name"]);
        });

        it("rejects a missing worksheet name", async () => {
            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(allianceId, entries, { fileName: "roster.xlsx", sourceSheetName: "" });

            expect(result.errors).toEqual(["Missing or invalid worksheet name"]);
        });

        // A caller that bypasses the ImportProvenance TypeScript type (e.g.
        // calling this server action directly) could send null/undefined/
        // non-string values. The action must fail closed with a normal
        // error result — never throw an uncaught TypeError from calling
        // `.trim()` on a non-string before validation runs.
        it("fails closed instead of throwing when fileName is null", async () => {
            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(
                allianceId,
                entries,
                { fileName: null, sourceSheetName: "Sheet1" } as never
            );

            expect(result.errors).toEqual(["Missing or invalid file name"]);
            expect(result.memberImportId).toBeNull();
        });

        it("fails closed instead of throwing when fileName is a non-string", async () => {
            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(
                allianceId,
                entries,
                { fileName: 12345, sourceSheetName: "Sheet1" } as never
            );

            expect(result.errors).toEqual(["Missing or invalid file name"]);
        });

        it("fails closed instead of throwing when sourceSheetName is undefined", async () => {
            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(
                allianceId,
                entries,
                { fileName: "roster.xlsx", sourceSheetName: undefined } as never
            );

            expect(result.errors).toEqual(["Missing or invalid worksheet name"]);
            expect(result.memberImportId).toBeNull();
        });
    });

    describe("create provenance integrity", () => {
        it("fails the whole import when createManyAndReturn returns fewer rows than requested", async () => {
            mockAllianceMember.findMany.mockResolvedValue([]);
            // Simulate an unexpected short create (e.g. a skipDuplicates
            // collision): two entries requested, only one row returned.
            mockAllianceMember.createManyAndReturn.mockResolvedValueOnce([
                {
                    id: "created-0",
                    playerName: "Player One",
                    thp: null,
                    role: null,
                    archivedAt: null,
                    discordName: null,
                    squadPower: null,
                    joinedAt: null,
                    userId: null,
                    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
                },
            ]);

            const entries = withSourceRows([{ playerName: "Player One" }, { playerName: "Player Two" }]);
            const result = await importMembers(allianceId, entries, provenance);

            expect(result.created).toBe(0);
            expect(result.restored).toBe(0);
            expect(result.errors).toEqual(["Failed to create members. Please try again."]);
            expect(result.memberImportId).toBeNull();
            // The whole transaction rolled back: no partial history is ever written.
            expect(mockMemberImport.create).not.toHaveBeenCalled();
        });
    });

    describe("sourceRow validation", () => {
        it("rejects a zero sourceRow", async () => {
            const result = await importMembers(
                allianceId,
                [{ playerName: "Player One", sourceRow: 0 }],
                provenance
            );

            expect(result.errors[0]).toContain("Invalid source row");
            expect(result.memberImportId).toBeNull();
        });

        it("rejects a negative sourceRow", async () => {
            const result = await importMembers(
                allianceId,
                [{ playerName: "Player One", sourceRow: -1 }],
                provenance
            );

            expect(result.errors[0]).toContain("Invalid source row");
        });

        it("rejects a non-integer sourceRow", async () => {
            const result = await importMembers(
                allianceId,
                [{ playerName: "Player One", sourceRow: 1.5 }],
                provenance
            );

            expect(result.errors[0]).toContain("Invalid source row");
        });

        it("rejects a sourceRow beyond the parser's physical row ceiling", async () => {
            const result = await importMembers(
                allianceId,
                [{ playerName: "Player One", sourceRow: 100_000 }],
                provenance
            );

            expect(result.errors[0]).toContain("Invalid source row");
        });

        it("rejects duplicate sourceRow values across submitted entries", async () => {
            const result = await importMembers(
                allianceId,
                [
                    { playerName: "Player One", sourceRow: 1 },
                    { playerName: "Player Two", sourceRow: 1 },
                ],
                provenance
            );

            expect(result.errors[0]).toContain("Duplicate source row 1");
            expect(result.memberImportId).toBeNull();
        });
    });

    describe("history gate", () => {
        it("does not create a MemberImport row when permission is denied", async () => {
            const { requireAllianceAccess } = await import("@/app/src/lib/auth/requireAllianceAccess");
            vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
                user: { id: "actor-user-1", email: "session-actor@example.com" },
                permissions: { canImportMembers: false },
            } as never);

            const entries = withSourceRows([{ playerName: "Player One" }]);
            const result = await importMembers(allianceId, entries, provenance);

            expect(result.errors).toEqual(["You don't have permission to import members"]);
            expect(result.memberImportId).toBeNull();
            expect(mockMemberImport.create).not.toHaveBeenCalled();
        });

        it("does not create a MemberImport row for a zero-net-effect commit (all rows skipped)", async () => {
            mockAllianceMember.findMany.mockResolvedValue([
                { id: "active-1", playerName: "Existing Active One", archivedAt: null, thp: null, role: null },
            ]);

            const entries = withSourceRows([{ playerName: "Existing Active One" }]);
            const result = await importMembers(allianceId, entries, provenance);

            expect(result.created).toBe(0);
            expect(result.restored).toBe(0);
            expect(result.skippedExisting).toBe(1);
            expect(result.memberImportId).toBeNull();
            expect(mockMemberImport.create).not.toHaveBeenCalled();
        });
    });
});
