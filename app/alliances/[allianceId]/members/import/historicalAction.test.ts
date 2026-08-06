import { describe, it, expect, vi, beforeEach } from "vitest";
import { importHistoricalRoster } from "./historicalAction";
import type { HistoricalRosterEntry } from "./historicalAction";
import { normalizeName } from "@/app/src/lib/memberMatcher";
import { classifyHistoricalRosterRow } from "./historicalClassification";
import { computeHistoricalImportFingerprint } from "./historicalImportFingerprint";
import type { HistoricalFingerprintRow } from "./historicalImportFingerprint";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn().mockResolvedValue({
        user: { id: "actor-user-1", email: "session-actor@example.com" },
        permissions: { canImportMembers: true, canManageMembers: true },
    }),
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => {
    const mockAllianceMember = {
        findMany: vi.fn(),
        count: vi.fn(),
        createManyAndReturn: vi.fn(
            async ({
                data,
            }: {
                data: Array<{ playerName: string; thp: number | null; role: string | null; archivedAt: Date | null }>;
            }) =>
                data.map((d, i) => ({
                    id: `created-${i}`,
                    playerName: d.playerName,
                    thp: d.thp,
                    role: d.role,
                    archivedAt: d.archivedAt,
                    discordName: null,
                    squadPower: null,
                    joinedAt: null,
                    userId: null,
                    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
                }))
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn(),
    };

    const mockUser = {
        findUnique: vi.fn().mockResolvedValue({ email: "actor@example.com", displayName: "Test Actor" }),
    };

    const mockMemberImport = {
        create: vi.fn().mockResolvedValue({ id: "import-1" }),
    };

    // Shared reference: the code under test only ever calls `tx.$executeRaw`
    // (from inside the transaction callback), never `prisma.$executeRaw`
    // directly — using one mock instance for both keeps the reference
    // reachable from the test file regardless of which object it's read off.
    const sharedExecuteRaw = vi.fn().mockResolvedValue(1);

    const mockTx = {
        allianceMember: mockAllianceMember,
        user: mockUser,
        memberImport: mockMemberImport,
        $executeRaw: sharedExecuteRaw,
    };

    return {
        prisma: {
            allianceMember: mockAllianceMember,
            user: mockUser,
            memberImport: mockMemberImport,
            $executeRaw: sharedExecuteRaw,
            $transaction: vi.fn((callback) => callback(mockTx)),
        },
    };
});

import { prisma } from "@/app/src/lib/prisma";

const mockAllianceMember = prisma.allianceMember as unknown as {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    createManyAndReturn: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findFirstOrThrow: ReturnType<typeof vi.fn>;
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
    mockAllianceMember.updateMany.mockResolvedValue({ count: 1 });
});

function withSourceRows(rawEntries: Omit<HistoricalRosterEntry, "sourceRow">[]): HistoricalRosterEntry[] {
    return rawEntries.map((e, i) => ({ ...e, sourceRow: i + 1 }));
}

const provenance = { fileName: "old-roster.xlsx", sourceSheetName: "Sheet1" };

type ExistingMember = { id: string; playerName: string; archivedAt: Date | null; thp: number | null; role: string | null };

/**
 * Mirrors exactly what a well-behaved client computes: classify each
 * selected entry against the existing-members list using the same shared
 * `classifyHistoricalRosterRow`, then hash it into a fingerprint. Used to
 * build a valid `expectedFingerprint` for tests that aren't specifically
 * exercising the stale-preview check.
 */
function buildValidFingerprint(existingMembers: ExistingMember[], entries: HistoricalRosterEntry[]): string {
    const existingByName = new Map(existingMembers.map((m) => [normalizeName(m.playerName), m]));
    const seen = new Set<string>();
    const rows: HistoricalFingerprintRow[] = [];

    for (const entry of entries) {
        const normalized = normalizeName(entry.playerName);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        if (entry.selected === false) continue;

        const existing = existingByName.get(normalized);
        const classification = classifyHistoricalRosterRow(
            { matched: !!existing, currentlyArchived: existing ? existing.archivedAt !== null : false },
            entry.finalStatus
        );
        if (classification.outcome === "UNASSIGNED_BLOCKED") continue;

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

describe("importHistoricalRoster", () => {
    const allianceId = "alliance-123";

    it("creates a new member as active", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Brand New Hero", thp: "10000", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.createdActive).toBe(1);
        expect(result.createdArchived).toBe(0);
        expect(result.memberImportId).toBe("import-1");
        expect(mockAllianceMember.createManyAndReturn).toHaveBeenCalledWith(
            expect.objectContaining({
                data: [expect.objectContaining({ playerName: "Brand New Hero", thp: 10000, archivedAt: null })],
            })
        );
    });

    it("creates a new member directly as archived, consuming zero active capacity", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(100); // alliance is at the cap

        const entries = withSourceRows([
            { playerName: "Old Veteran", finalStatus: "archived" },
        ]);
        const fingerprint = buildValidFingerprint([], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.createdActive).toBe(0);
        expect(result.createdArchived).toBe(1);
        expect(mockAllianceMember.createManyAndReturn).toHaveBeenCalledWith(
            expect.objectContaining({
                data: [expect.objectContaining({ playerName: "Old Veteran", archivedAt: expect.any(Date) })],
            })
        );
    });

    it("restores an archived member to active while preserving current thp/role, ignoring the file's values", async () => {
        const archivedMember: ExistingMember = {
            id: "archived-1",
            playerName: "Archived Hero",
            archivedAt: new Date("2023-01-01T00:00:00.000Z"),
            thp: 40000,
            role: null,
        };
        mockAllianceMember.findMany.mockResolvedValue([archivedMember]);
        mockAllianceMember.count.mockResolvedValue(0);
        mockAllianceMember.findFirstOrThrow.mockResolvedValue({
            id: "archived-1",
            playerName: "Archived Hero",
            thp: 40000,
            role: null,
            archivedAt: null,
            discordName: null,
            squadPower: null,
            joinedAt: null,
            userId: null,
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        });

        // The file supplies a different THP — historical mode must ignore it.
        const entries = withSourceRows([
            { playerName: "Archived Hero", thp: "999999", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([archivedMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.restored).toBe(1);
        expect(mockAllianceMember.updateMany).toHaveBeenCalledWith({
            where: { id: "archived-1", allianceId, archivedAt: { not: null } },
            data: { archivedAt: null },
        });
        // The file's THP is never written anywhere.
        expect(mockAllianceMember.updateMany).not.toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ thp: expect.anything() }) })
        );
    });

    it("skips an existing active member requesting Archived as a lifecycle conflict, without mutating it", async () => {
        const activeMember: ExistingMember = {
            id: "active-1",
            playerName: "Current Leader",
            archivedAt: null,
            thp: 5000,
            role: "R5",
        };
        mockAllianceMember.findMany.mockResolvedValue([activeMember]);
        mockAllianceMember.count.mockResolvedValue(1);

        const entries = withSourceRows([
            { playerName: "Current Leader", finalStatus: "archived" },
        ]);
        const fingerprint = buildValidFingerprint([activeMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.skippedLifecycleConflict).toBe(1);
        expect(result.createdActive).toBe(0);
        expect(result.createdArchived).toBe(0);
        expect(result.restored).toBe(0);
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
        expect(mockAllianceMember.updateMany).not.toHaveBeenCalled();
        // Zero mutation for this row -> zero-net-effect commit -> no history row.
        expect(result.memberImportId).toBeNull();
    });

    it("counts an already-matching row (existing active + Active) as skippedExisting", async () => {
        const activeMember: ExistingMember = {
            id: "active-1",
            playerName: "Steady Member",
            archivedAt: null,
            thp: 5000,
            role: null,
        };
        mockAllianceMember.findMany.mockResolvedValue([activeMember]);
        mockAllianceMember.count.mockResolvedValue(1);

        const entries = withSourceRows([
            { playerName: "Steady Member", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([activeMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.skippedExisting).toBe(1);
        expect(result.memberImportId).toBeNull();
    });

    it("counts an already-archived row (existing archived + Archived) as skippedExisting, not restored", async () => {
        const archivedMember: ExistingMember = {
            id: "archived-1",
            playerName: "Still Archived",
            archivedAt: new Date("2023-01-01T00:00:00.000Z"),
            thp: null,
            role: null,
        };
        mockAllianceMember.findMany.mockResolvedValue([archivedMember]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Still Archived", finalStatus: "archived" },
        ]);
        const fingerprint = buildValidFingerprint([archivedMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.skippedExisting).toBe(1);
        expect(result.restored).toBe(0);
        expect(mockAllianceMember.updateMany).not.toHaveBeenCalled();
    });

    it("rejects a selected row that is still unassigned, aborting the whole import", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Indecisive Player", finalStatus: "unassigned", selected: true },
        ]);
        // Fingerprint value is irrelevant here — the unassigned check runs first.
        const result = await importHistoricalRoster(allianceId, entries, provenance, "[]");

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("must have an Active or Archived outcome assigned");
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("aborts the entire import when the live fingerprint doesn't match what the client submitted", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Fresh Face", finalStatus: "active" },
        ]);

        const result = await importHistoricalRoster(allianceId, entries, provenance, "stale-fingerprint-value");

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("out of date");
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("aborts when a concurrent lifecycle change is detected at restore time (live guard)", async () => {
        const archivedMember: ExistingMember = {
            id: "archived-1",
            playerName: "Archived Hero",
            archivedAt: new Date("2023-01-01T00:00:00.000Z"),
            thp: null,
            role: null,
        };
        mockAllianceMember.findMany.mockResolvedValue([archivedMember]);
        mockAllianceMember.count.mockResolvedValue(0);
        // Simulate another transaction having already restored this member
        // between the classification read and this guarded update.
        mockAllianceMember.updateMany.mockResolvedValue({ count: 0 });

        const entries = withSourceRows([
            { playerName: "Archived Hero", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([archivedMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("out of date");
        expect(result.memberImportId).toBeNull();
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("validates THP only for created rows, never for a preserved restore", async () => {
        const archivedMember: ExistingMember = {
            id: "archived-1",
            playerName: "Archived Hero",
            archivedAt: new Date("2023-01-01T00:00:00.000Z"),
            thp: 1000,
            role: null,
        };
        mockAllianceMember.findMany.mockResolvedValue([archivedMember]);
        mockAllianceMember.count.mockResolvedValue(0);
        mockAllianceMember.findFirstOrThrow.mockResolvedValue({
            id: "archived-1",
            playerName: "Archived Hero",
            thp: 1000,
            role: null,
            archivedAt: null,
            discordName: null,
            squadPower: null,
            joinedAt: null,
            userId: null,
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        });

        // Invalid THP on the restore row — must be ignored, not block the import.
        const entries = withSourceRows([
            { playerName: "Archived Hero", thp: "not-a-number", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([archivedMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.restored).toBe(1);
    });

    it("rejects invalid THP for a row that will actually be created", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "New Player", thp: "not-a-number", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Invalid THP value");
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("enforces active-roster capacity counting only CREATE_ACTIVE and RESTORE outcomes", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(99);

        const entries = withSourceRows([
            { playerName: "New Active One", finalStatus: "active" },
            { playerName: "New Active Two", finalStatus: "active" },
            { playerName: "New Archived One", finalStatus: "archived" },
        ]);
        const fingerprint = buildValidFingerprint([], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Your alliance has 99 active members, so you can add 1 more");
        expect(result.errors[0]).toContain("2 new");
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
    });

    it("requires both canImportMembers and canManageMembers", async () => {
        const { requireAllianceAccess } = await import("@/app/src/lib/auth/requireAllianceAccess");
        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "actor-user-1", email: "session-actor@example.com" },
            permissions: { canImportMembers: true, canManageMembers: false },
        } as never);

        const entries = withSourceRows([
            { playerName: "Someone", finalStatus: "active" },
        ]);
        const result = await importHistoricalRoster(allianceId, entries, provenance, "[]");

        expect(result.errors).toEqual(["You don't have permission to import a historical roster"]);
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("denies when only canManageMembers is present but not canImportMembers", async () => {
        const { requireAllianceAccess } = await import("@/app/src/lib/auth/requireAllianceAccess");
        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "actor-user-1", email: "session-actor@example.com" },
            permissions: { canImportMembers: false, canManageMembers: true },
        } as never);

        const entries = withSourceRows([
            { playerName: "Someone", finalStatus: "active" },
        ]);
        const result = await importHistoricalRoster(allianceId, entries, provenance, "[]");

        expect(result.errors).toEqual(["You don't have permission to import a historical roster"]);
    });

    it("does not write a MemberImport row for a zero-net-effect commit", async () => {
        const activeMember: ExistingMember = {
            id: "active-1",
            playerName: "Steady Member",
            archivedAt: null,
            thp: null,
            role: null,
        };
        mockAllianceMember.findMany.mockResolvedValue([activeMember]);
        mockAllianceMember.count.mockResolvedValue(1);

        const entries = withSourceRows([
            { playerName: "Steady Member", finalStatus: "active" },
        ]);
        const fingerprint = buildValidFingerprint([activeMember], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.memberImportId).toBeNull();
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("records mode: HISTORICAL and createdArchivedCount on the MemberImport row", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Active One", finalStatus: "active" },
            { playerName: "Archived One", finalStatus: "archived" },
        ]);
        const fingerprint = buildValidFingerprint([], entries);

        await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(mockMemberImport.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    mode: "HISTORICAL",
                    createdCount: 2,
                    createdArchivedCount: 1,
                }),
            })
        );
    });

    it("rejects the whole import when a selected row carries a runtime-invalid status, even though TypeScript's union type would normally prevent it", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        // Bypasses the TypeScript union on purpose — a direct action caller
        // (not the client component) could submit any string over the wire.
        const entries = withSourceRows([
            { playerName: "Tampered Row", finalStatus: "bogus-status" as never, selected: true },
        ]);

        const result = await importHistoricalRoster(allianceId, entries, provenance, "[]");

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("has an invalid status");
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("rejects the whole import when two existing members normalize to the same name, instead of silently matching one", async () => {
        const memberA: ExistingMember = {
            id: "member-a",
            playerName: "Team Player",
            archivedAt: new Date("2023-01-01T00:00:00.000Z"),
            thp: null,
            role: null,
        };
        const memberB: ExistingMember = {
            id: "member-b",
            playerName: "TEAM  PLAYER", // normalizes to the same key as memberA
            archivedAt: null,
            thp: 1000,
            role: "R1",
        };
        mockAllianceMember.findMany.mockResolvedValue([memberA, memberB]);
        mockAllianceMember.count.mockResolvedValue(1);

        const entries = withSourceRows([
            { playerName: "Team Player", finalStatus: "active" },
        ]);
        // Fingerprint value is irrelevant — the ambiguous-match check runs
        // before the fingerprint comparison would even matter here.
        const result = await importHistoricalRoster(allianceId, entries, provenance, "[]");

        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("matches more than one existing member");
        expect(mockAllianceMember.updateMany).not.toHaveBeenCalled();
        expect(mockAllianceMember.createManyAndReturn).not.toHaveBeenCalled();
        expect(mockMemberImport.create).not.toHaveBeenCalled();
    });

    it("re-reads and reclassifies every member a second time immediately before committing any mutation, instead of taking a row lock on AllianceMember", async () => {
        // A `SELECT ... FOR UPDATE` over every AllianceMember row here would
        // take an Alliance-then-AllianceMember lock order, the exact
        // reverse of bulkArchiveMembers's AllianceMember-then-Alliance
        // order (bulk-actions.ts) — risking a real Postgres deadlock. This
        // action instead re-reads and reclassifies right before any
        // mutation, aborting on drift instead of blocking a concurrent
        // writer. See historicalAction.integration.test.ts for the real-
        // Postgres proof that racing bulkArchiveMembers never deadlocks.
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([{ playerName: "New Person", finalStatus: "active" }]);
        const fingerprint = buildValidFingerprint([], entries);

        await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        // Once for the classification/fingerprint read, once for the
        // end-of-transaction stale recheck — never an explicit member lock.
        expect(mockAllianceMember.findMany).toHaveBeenCalledTimes(2);
    });

    it("skips unselected rows and never includes them in the fingerprint contract", async () => {
        mockAllianceMember.findMany.mockResolvedValue([]);
        mockAllianceMember.count.mockResolvedValue(0);

        const entries = withSourceRows([
            { playerName: "Included Player", finalStatus: "active", selected: true },
            { playerName: "Excluded Player", finalStatus: "unassigned", selected: false },
        ]);
        const fingerprint = buildValidFingerprint([], entries);

        const result = await importHistoricalRoster(allianceId, entries, provenance, fingerprint);

        expect(result.errors).toEqual([]);
        expect(result.createdActive).toBe(1);
        expect(result.skippedUnselected).toBe(1);
    });
});
