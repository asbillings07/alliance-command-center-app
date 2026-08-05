import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/allianceMemberLock", () => ({
    withAllianceMemberLock: vi.fn(),
}));

vi.mock("@/app/src/lib/touchAllianceSetupActivity", () => ({
    touchAllianceSetupActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/src/lib/cache/revalidateAllianceData", () => ({
    revalidateAllianceData: vi.fn(),
}));

vi.mock("../rollbackPreview", () => ({
    computeImportRollbackPreview: vi.fn(),
}));

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { computeImportRollbackPreview } from "../rollbackPreview";
import { rollbackImport } from "./action";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";

const mockRequireAccess = requireAllianceAccess as ReturnType<typeof vi.fn>;
const mockWithLock = withAllianceMemberLock as ReturnType<typeof vi.fn>;
const mockComputePreview = computeImportRollbackPreview as ReturnType<typeof vi.fn>;

const allianceId = "alliance-1";
const importId = "import-1";

function buildFormData(resolutions: Record<string, string> = {}): FormData {
    const formData = new FormData();
    formData.set("allianceId", allianceId);
    formData.set("importId", importId);
    for (const [changeId, value] of Object.entries(resolutions)) {
        formData.set(`resolution:${changeId}`, value);
    }
    return formData;
}

function buildTx(overrides: { changes?: unknown[]; rollback?: { id: string } | null } = {}) {
    return {
        memberImport: {
            findFirst: vi.fn().mockResolvedValue({
                id: importId,
                createdAt: new Date("2026-01-01T00:00:00Z"),
                rollback: overrides.rollback ?? null,
                changes: overrides.changes ?? [],
            }),
        },
        allianceMember: {
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
        },
        user: {
            findUnique: vi.fn().mockResolvedValue({ email: "owner@example.com", displayName: "Owner Name" }),
        },
        memberImportRollback: {
            create: vi.fn().mockResolvedValue({ id: "rollback-1" }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function buildChange(overrides: Record<string, unknown> = {}) {
    return {
        id: "change-1",
        memberImportId: importId,
        allianceMemberId: "member-1",
        playerNameSnapshot: "Alice",
        sourceRow: 1,
        changeType: MemberImportChangeType.CREATED,
        archivedAtBefore: null,
        archivedAtAfter: null,
        thpBefore: null,
        thpAfter: 1000,
        roleBefore: null,
        roleAfter: "Member",
        discordNameAfter: null,
        squadPowerAfter: null,
        joinedAtAfter: null,
        userIdAfter: null,
        memberUpdatedAtAfter: new Date("2026-01-01T00:05:00Z"),
        ...overrides,
    };
}

function buildPreviewItem(overrides: Record<string, unknown> = {}) {
    return {
        changeId: "change-1",
        playerNameSnapshot: "Alice",
        sourceRow: 1,
        changeType: MemberImportChangeType.CREATED,
        allianceMemberId: "member-1",
        currentlyArchived: false,
        hasConflict: false,
        driftedFields: [],
        hadLaterImportInvolvement: false,
        hadLinkedUser: false,
        metricEntryCount: 0,
        leadershipNoteCount: 0,
        invitationCount: 0,
        requiresResolution: false,
        defaultResolution: "DELETED",
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccess.mockResolvedValue({
        user: { id: "user-1", email: "owner@example.com" },
        permissions: { canRollbackMemberImports: true },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockWithLock.mockImplementation(async (_allianceId: string, fn: (tx: unknown) => unknown) => fn(buildTx()));
});

describe("rollbackImport", () => {
    it("rejects an invalid request missing allianceId/importId", async () => {
        const formData = new FormData();
        const result = await rollbackImport(formData);
        expect(result).toEqual({ success: false, error: "Invalid request" });
        expect(mockRequireAccess).not.toHaveBeenCalled();
    });

    it("rejects a caller without ROLLBACK_MEMBER_IMPORTS", async () => {
        mockRequireAccess.mockResolvedValue({
            user: { id: "user-1" },
            permissions: { canRollbackMemberImports: false },
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

        const result = await rollbackImport(buildFormData());

        expect(result).toEqual({
            success: false,
            error: "You don't have permission to undo a member import",
        });
        expect(mockWithLock).not.toHaveBeenCalled();
    });

    it("fails closed when the import doesn't exist in this alliance", async () => {
        const tx = buildTx();
        tx.memberImport.findFirst.mockResolvedValue(null);
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));

        const result = await rollbackImport(buildFormData());

        expect(result).toEqual({ success: false, error: "This import could not be found." });
    });

    it("fails closed when the import was already rolled back", async () => {
        const tx = buildTx({ rollback: { id: "existing-rollback" } });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));

        const result = await rollbackImport(buildFormData());

        expect(result).toEqual({ success: false, error: "This import has already been undone." });
        expect(tx.memberImportRollback.create).not.toHaveBeenCalled();
    });

    it("aborts when the fresh preview requires a resolution the submission doesn't have — a stale page", async () => {
        const tx = buildTx({ changes: [buildChange()] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [buildPreviewItem({ requiresResolution: true, defaultResolution: null })],
        });

        // Submission has no resolution:change-1 entry at all.
        const result = await rollbackImport(buildFormData());

        expect(result).toEqual({
            success: false,
            error: "This import's state changed since you loaded this page. Review the updated preview and try again.",
        });
        expect(tx.allianceMember.delete).not.toHaveBeenCalled();
        expect(tx.allianceMember.update).not.toHaveBeenCalled();
        expect(tx.memberImportRollback.create).not.toHaveBeenCalled();
    });

    it("deletes a clean CREATED row and records a fully-clean ROLLED_BACK outcome", async () => {
        const tx = buildTx({ changes: [buildChange()] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [buildPreviewItem({ defaultResolution: "DELETED" })],
        });

        const result = await rollbackImport(buildFormData());

        expect(tx.allianceMember.delete).toHaveBeenCalledWith({ where: { id: "member-1" } });
        expect(tx.allianceMember.update).not.toHaveBeenCalled();
        expect(tx.memberImportRollback.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    memberImportId: importId,
                    allianceId,
                    outcome: "ROLLED_BACK",
                    deletedCount: 1,
                    revertedCount: 0,
                    retainedActiveCount: 0,
                    archivedPreservingHistoryCount: 0,
                    retainedArchivedCount: 0,
                    skippedConflictCount: 0,
                    results: {
                        create: [
                            expect.objectContaining({
                                memberImportChangeId: "change-1",
                                resolution: "DELETED",
                            }),
                        ],
                    },
                }),
            })
        );
        expect(result).toMatchObject({ success: true, outcome: "ROLLED_BACK", deletedCount: 1 });
        expect(touchAllianceSetupActivity).toHaveBeenCalled();
        expect(revalidateAllianceData).toHaveBeenCalledWith({
            allianceId,
            domains: ["members", "setup", "dashboard", "reports", "member-imports"],
        });
    });

    it("reverts a clean RESTORED row to its pre-import archivedAt/thp/role as one unit", async () => {
        const change = buildChange({
            changeType: MemberImportChangeType.RESTORED,
            archivedAtBefore: new Date("2025-06-01T00:00:00Z"),
            thpBefore: 500,
            roleBefore: "Elder",
        });
        const tx = buildTx({ changes: [change] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [
                buildPreviewItem({
                    changeType: MemberImportChangeType.RESTORED,
                    defaultResolution: "REVERTED_TO_PRE_IMPORT_STATE",
                }),
            ],
        });

        const result = await rollbackImport(buildFormData());

        expect(tx.allianceMember.update).toHaveBeenCalledWith({
            where: { id: "member-1" },
            data: {
                archivedAt: change.archivedAtBefore,
                thp: change.thpBefore,
                role: change.roleBefore,
            },
        });
        expect(tx.allianceMember.delete).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, outcome: "ROLLED_BACK", revertedCount: 1 });
    });

    it("applies an owner's explicit RETAIN_ACTIVE choice without mutating the member, and reports a non-clean outcome", async () => {
        const tx = buildTx({ changes: [buildChange()] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [buildPreviewItem({ hasConflict: true, requiresResolution: true, defaultResolution: null })],
        });

        const result = await rollbackImport(buildFormData({ "change-1": "RETAIN_ACTIVE" }));

        expect(tx.allianceMember.update).not.toHaveBeenCalled();
        expect(tx.allianceMember.delete).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            success: true,
            outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
            retainedActiveCount: 1,
        });
    });

    it("applies an owner's explicit ARCHIVE_PRESERVING_HISTORY choice by archiving the member now, not by replaying archivedAtAfter", async () => {
        const tx = buildTx({ changes: [buildChange()] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [buildPreviewItem({ hasConflict: true, requiresResolution: true, defaultResolution: null })],
        });

        const before = Date.now();
        const result = await rollbackImport(buildFormData({ "change-1": "ARCHIVE_PRESERVING_HISTORY" }));
        const after = Date.now();

        expect(tx.allianceMember.update).toHaveBeenCalledTimes(1);
        const call = tx.allianceMember.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: "member-1" });
        expect(call.data.archivedAt).toBeInstanceOf(Date);
        expect((call.data.archivedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
        expect((call.data.archivedAt as Date).getTime()).toBeLessThanOrEqual(after);
        expect(result).toMatchObject({
            success: true,
            outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
            archivedPreservingHistoryCount: 1,
        });
    });

    it("ignores a spurious resolution submitted for a non-actionable row and applies its own default instead", async () => {
        const tx = buildTx({ changes: [buildChange()] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [buildPreviewItem({ requiresResolution: false, defaultResolution: "RETAINED_ARCHIVED" })],
        });

        const result = await rollbackImport(buildFormData({ "change-1": "ARCHIVE_PRESERVING_HISTORY" }));

        expect(tx.allianceMember.update).not.toHaveBeenCalled();
        expect(tx.allianceMember.delete).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, retainedArchivedCount: 1 });
    });

    it("leaves a SKIPPED_CONFLICT row completely untouched", async () => {
        const tx = buildTx({ changes: [buildChange({ changeType: MemberImportChangeType.RESTORED })] });
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [
                buildPreviewItem({
                    changeType: MemberImportChangeType.RESTORED,
                    hasConflict: true,
                    defaultResolution: "SKIPPED_CONFLICT",
                }),
            ],
        });

        const result = await rollbackImport(buildFormData());

        expect(tx.allianceMember.update).not.toHaveBeenCalled();
        expect(tx.allianceMember.delete).not.toHaveBeenCalled();
        expect(touchAllianceSetupActivity).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            success: true,
            outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
            skippedConflictCount: 1,
        });
    });

    it("rethrows an unexpected error instead of swallowing it into a generic message", async () => {
        const tx = buildTx({ changes: [buildChange()] });
        tx.user.findUnique.mockResolvedValue(null); // triggers the "Acting user not found" throw
        mockWithLock.mockImplementation(async (_id: string, fn: (tx: unknown) => unknown) => fn(tx));
        mockComputePreview.mockResolvedValue({
            memberImportId: importId,
            items: [buildPreviewItem({ defaultResolution: "DELETED" })],
        });

        await expect(rollbackImport(buildFormData())).rejects.toThrow("Acting user not found");
    });
});
