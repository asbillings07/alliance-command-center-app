import { describe, it, expect, vi } from "vitest";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import {
    computeImportRollbackPreview,
    computePreviewFingerprint,
    type ImportChangeForRollbackPreview,
    type RollbackPreviewItem,
} from "./rollbackPreview";

const MEMBER_IMPORT = { id: "import-1", createdAt: new Date("2026-01-01T00:00:00Z") };
const ALLIANCE_ID = "alliance-1";

type LiveMember = {
    id: string;
    thp: number | null;
    role: string | null;
    archivedAt: Date | null;
    discordName: string | null;
    squadPower: number | null;
    joinedAt: Date | null;
    userId: string | null;
    updatedAt: Date;
};

/** Builds a fake Prisma-shaped client exposing only the delegates/methods
 * computeImportRollbackPreview actually calls, structurally satisfying
 * Prisma.TransactionClient for the purposes of this unit test. */
function buildClient(options: {
    liveMembers?: LiveMember[];
    laterInvolvementMemberIds?: string[];
    metricCounts?: Record<string, number>;
    noteCounts?: Record<string, number>;
    invitationCounts?: Record<string, number>;
}) {
    const toGroupByResult = (counts: Record<string, number> | undefined) =>
        Object.entries(counts ?? {}).map(([allianceMemberId, count]) => ({
            allianceMemberId,
            _count: { _all: count },
        }));

    return {
        allianceMember: {
            findMany: vi.fn().mockResolvedValue(options.liveMembers ?? []),
        },
        memberImportChange: {
            findMany: vi.fn().mockResolvedValue(
                (options.laterInvolvementMemberIds ?? []).map((allianceMemberId) => ({ allianceMemberId }))
            ),
        },
        memberMetricEntry: {
            groupBy: vi.fn().mockResolvedValue(toGroupByResult(options.metricCounts)),
        },
        leadershipNote: {
            groupBy: vi.fn().mockResolvedValue(toGroupByResult(options.noteCounts)),
        },
        invitation: {
            groupBy: vi.fn().mockResolvedValue(toGroupByResult(options.invitationCounts)),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function buildLiveMember(overrides: Partial<LiveMember> & { id: string }): LiveMember {
    return {
        thp: 1000,
        role: "Member",
        archivedAt: null,
        discordName: null,
        squadPower: null,
        joinedAt: null,
        userId: null,
        updatedAt: new Date("2026-01-01T00:05:00Z"),
        ...overrides,
    };
}

function buildCreatedChange(overrides: Partial<ImportChangeForRollbackPreview> = {}): ImportChangeForRollbackPreview {
    return {
        id: "change-1",
        memberImportId: MEMBER_IMPORT.id,
        allianceMemberId: "member-1",
        playerNameSnapshot: "Alice",
        sourceRow: 1,
        changeType: MemberImportChangeType.CREATED,
        archivedAtAfter: null,
        thpAfter: 1000,
        roleAfter: "Member",
        discordNameAfter: null,
        squadPowerAfter: null,
        joinedAtAfter: null,
        userIdAfter: null,
        memberUpdatedAtAfter: new Date("2026-01-01T00:05:00Z"),
        ...overrides,
    };
}

function buildRestoredChange(overrides: Partial<ImportChangeForRollbackPreview> = {}): ImportChangeForRollbackPreview {
    return {
        id: "change-2",
        memberImportId: MEMBER_IMPORT.id,
        allianceMemberId: "member-2",
        playerNameSnapshot: "Bob",
        sourceRow: 2,
        changeType: MemberImportChangeType.RESTORED,
        archivedAtAfter: null,
        thpAfter: 2000,
        roleAfter: "Officer",
        discordNameAfter: "bob#1234",
        squadPowerAfter: 500,
        joinedAtAfter: new Date("2025-01-01T00:00:00Z"),
        userIdAfter: null,
        memberUpdatedAtAfter: new Date("2026-01-01T00:05:00Z"),
        ...overrides,
    };
}

describe("computeImportRollbackPreview", () => {
    describe("CREATED rows", () => {
        it("resolves to DELETED when the live row exactly matches the recorded snapshot", async () => {
            const change = buildCreatedChange();
            const liveMember = buildLiveMember({ id: "member-1" });
            const client = buildClient({ liveMembers: [liveMember] });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items).toHaveLength(1);
            expect(preview.items[0]).toMatchObject({
                hasConflict: false,
                requiresResolution: false,
                defaultResolution: "DELETED",
                driftedFields: [],
            });
            // rollbackImport's write-guard is built directly from this —
            // it must be the exact row this classification was computed
            // from, not a copy of the recorded "after" snapshot.
            expect(preview.items[0].liveSnapshot).toMatchObject({
                thp: liveMember.thp,
                role: liveMember.role,
                archivedAt: liveMember.archivedAt,
                updatedAt: liveMember.updatedAt,
            });
        });

        it("populates liveSnapshot from the current row even while conflicted, not from the recorded after-snapshot", async () => {
            const change = buildCreatedChange();
            const liveMember = buildLiveMember({ id: "member-1", thp: 5000 });
            const client = buildClient({ liveMembers: [liveMember] });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0].liveSnapshot).toMatchObject({ thp: 5000 });
        });

        it("flags a conflict when a scalar has drifted since import, and requires an explicit resolution while the member is active", async () => {
            const change = buildCreatedChange();
            const client = buildClient({
                liveMembers: [buildLiveMember({ id: "member-1", thp: 5000 })],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                driftedFields: ["thp"],
                requiresResolution: true,
                defaultResolution: null,
                currentlyArchived: false,
            });
        });

        it("retains archived with no owner choice when a conflicted CREATED member is already archived — never reactivates as a side effect", async () => {
            const change = buildCreatedChange();
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({ id: "member-1", thp: 5000, archivedAt: new Date("2026-02-01T00:00:00Z") }),
                ],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                currentlyArchived: true,
                requiresResolution: false,
                defaultResolution: "RETAINED_ARCHIVED",
            });
        });

        it("flags every one of the eight tracked scalars independently", async () => {
            const otherUserId = "user-999";
            const change = buildCreatedChange({ userIdAfter: null });
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({
                        id: "member-1",
                        thp: 9999,
                        role: "Elder",
                        archivedAt: new Date("2026-03-01T00:00:00Z"),
                        discordName: "someone#0001",
                        squadPower: 12345,
                        joinedAt: new Date("2025-06-01T00:00:00Z"),
                        userId: otherUserId,
                        updatedAt: new Date("2026-03-01T00:00:01Z"),
                    }),
                ],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0].driftedFields.sort()).toEqual(
                [
                    "thp",
                    "role",
                    "archivedAt",
                    "discordName",
                    "squadPower",
                    "joinedAt",
                    "userId",
                    "updatedAt",
                ].sort()
            );
        });

        it("conflicts on a linked user even when every recorded scalar still matches", async () => {
            const change = buildCreatedChange();
            const client = buildClient({
                liveMembers: [buildLiveMember({ id: "member-1", userId: "user-1" })],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                hadLinkedUser: true,
                requiresResolution: true,
            });
        });

        it("conflicts on any protected dependency (metric entries, leadership notes, invitations) even with matching scalars", async () => {
            const client = buildClient({
                liveMembers: [buildLiveMember({ id: "member-1" })],
                metricCounts: { "member-1": 2 },
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [buildCreatedChange()]);

            expect(preview.items[0]).toMatchObject({ hasConflict: true, metricEntryCount: 2 });
        });

        it("conflicts on later-import involvement even when scalars still match", async () => {
            const change = buildCreatedChange();
            const client = buildClient({
                liveMembers: [buildLiveMember({ id: "member-1" })],
                laterInvolvementMemberIds: ["member-1"],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                hadLaterImportInvolvement: true,
                requiresResolution: true,
            });
        });
    });

    describe("RESTORED rows", () => {
        it("resolves to REVERTED_TO_PRE_IMPORT_STATE when the live row exactly matches the recorded snapshot", async () => {
            const change = buildRestoredChange();
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({
                        id: "member-2",
                        thp: 2000,
                        role: "Officer",
                        discordName: "bob#1234",
                        squadPower: 500,
                        joinedAt: new Date("2025-01-01T00:00:00Z"),
                        updatedAt: new Date("2026-01-01T00:05:00Z"),
                    }),
                ],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: false,
                requiresResolution: false,
                defaultResolution: "REVERTED_TO_PRE_IMPORT_STATE",
            });
        });

        it("skips a conflicted RESTORED row unconditionally — never actionable, regardless of current archive state", async () => {
            const change = buildRestoredChange();
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({
                        id: "member-2",
                        thp: 9999,
                        discordName: "bob#1234",
                        squadPower: 500,
                        joinedAt: new Date("2025-01-01T00:00:00Z"),
                    }),
                ],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                requiresResolution: false,
                defaultResolution: "SKIPPED_CONFLICT",
            });
        });

        it("conflicts on later-import involvement alone, even when every scalar still matches", async () => {
            const change = buildRestoredChange();
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({
                        id: "member-2",
                        thp: 2000,
                        role: "Officer",
                        discordName: "bob#1234",
                        squadPower: 500,
                        joinedAt: new Date("2025-01-01T00:00:00Z"),
                        updatedAt: new Date("2026-01-01T00:05:00Z"),
                    }),
                ],
                laterInvolvementMemberIds: ["member-2"],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                hadLaterImportInvolvement: true,
                defaultResolution: "SKIPPED_CONFLICT",
            });
        });

        it("never gathers or conflicts on protected-dependency counts for a RESTORED row", async () => {
            const change = buildRestoredChange();
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({
                        id: "member-2",
                        thp: 2000,
                        role: "Officer",
                        discordName: "bob#1234",
                        squadPower: 500,
                        joinedAt: new Date("2025-01-01T00:00:00Z"),
                        updatedAt: new Date("2026-01-01T00:05:00Z"),
                    }),
                ],
                metricCounts: { "member-2": 5 },
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({ hasConflict: false, metricEntryCount: 0 });
            expect(client.memberMetricEntry.groupBy).not.toHaveBeenCalled();
        });
    });

    describe("tenant scoping", () => {
        it("scopes the live-member lookup by the caller-supplied allianceId, not just the change's own claimed allianceMemberId", async () => {
            const change = buildCreatedChange();
            const client = buildClient({ liveMembers: [buildLiveMember({ id: "member-1" })] });

            await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            // MemberImportChange has no FK tying allianceMemberId to this
            // alliance (see this function's own doc comment) — the query
            // itself must be the enforcement point, not an assumption that
            // every change row's provenance is trustworthy.
            expect(client.allianceMember.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ allianceId: ALLIANCE_ID }),
                })
            );
        });

        it("treats a member the mocked query didn't return (as a real allianceId-scoped query would for a foreign-tenant id) exactly like a missing member — no live data, no lock-eligible snapshot", async () => {
            const change = buildCreatedChange();
            // Simulates a real DB honoring the allianceId filter: this
            // member exists, but not in ALLIANCE_ID, so an allianceId-scoped
            // findMany would never return it.
            const client = buildClient({ liveMembers: [] });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                currentlyArchived: null,
                liveSnapshot: null,
                requiresResolution: false,
                defaultResolution: "SKIPPED_CONFLICT",
            });
        });
    });

    describe("member no longer exists", () => {
        it("treats a missing live row as an unconditional conflict for a CREATED change", async () => {
            const change = buildCreatedChange();
            const client = buildClient({ liveMembers: [] });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                currentlyArchived: null,
                requiresResolution: false,
                defaultResolution: "SKIPPED_CONFLICT",
            });
            expect(preview.items[0].liveSnapshot).toBeNull();
        });

        it("treats a missing live row as an unconditional conflict for a RESTORED change", async () => {
            const change = buildRestoredChange();
            const client = buildClient({ liveMembers: [] });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({
                hasConflict: true,
                currentlyArchived: null,
                defaultResolution: "SKIPPED_CONFLICT",
            });
        });

        it("treats a null allianceMemberId (already SetNull'd) the same as a missing row, without querying for it", async () => {
            const change = buildCreatedChange({ allianceMemberId: null });
            const client = buildClient({ liveMembers: [] });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, [change]);

            expect(preview.items[0]).toMatchObject({ hasConflict: true, defaultResolution: "SKIPPED_CONFLICT" });
            // No live member id to look up at all — short-circuits before
            // ever querying, rather than issuing a vacuous `id IN ()` query.
            expect(client.allianceMember.findMany).not.toHaveBeenCalled();
        });
    });

    describe("batching", () => {
        it("issues exactly one query per dependency type regardless of how many changes are in the import", async () => {
            const changes = [
                buildCreatedChange({ id: "c1", allianceMemberId: "m1" }),
                buildCreatedChange({ id: "c2", allianceMemberId: "m2" }),
                buildRestoredChange({ id: "c3", allianceMemberId: "m3" }),
            ];
            const client = buildClient({
                liveMembers: [
                    buildLiveMember({ id: "m1" }),
                    buildLiveMember({ id: "m2" }),
                    buildLiveMember({
                        id: "m3",
                        thp: 2000,
                        role: "Officer",
                        discordName: "bob#1234",
                        squadPower: 500,
                        joinedAt: new Date("2025-01-01T00:00:00Z"),
                        updatedAt: new Date("2026-01-01T00:05:00Z"),
                    }),
                ],
            });

            const preview = await computeImportRollbackPreview(client, ALLIANCE_ID, MEMBER_IMPORT, changes);

            expect(preview.items).toHaveLength(3);
            expect(client.allianceMember.findMany).toHaveBeenCalledTimes(1);
            expect(client.memberImportChange.findMany).toHaveBeenCalledTimes(1);
            expect(client.memberMetricEntry.groupBy).toHaveBeenCalledTimes(1);
            expect(client.leadershipNote.groupBy).toHaveBeenCalledTimes(1);
            expect(client.invitation.groupBy).toHaveBeenCalledTimes(1);
            // Only CREATED member ids are checked for protected dependencies.
            expect(client.memberMetricEntry.groupBy).toHaveBeenCalledWith(
                expect.objectContaining({ where: { allianceMemberId: { in: ["m1", "m2"] } } })
            );
        });
    });
});

describe("computePreviewFingerprint", () => {
    function buildPreviewItem(overrides: Partial<RollbackPreviewItem> = {}): RollbackPreviewItem {
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
            liveSnapshot: buildLiveMember({ id: "member-1" }),
            requiresResolution: false,
            defaultResolution: "DELETED",
            ...overrides,
        };
    }

    it("is identical for the same classification regardless of item order", () => {
        const a = buildPreviewItem({ changeId: "change-1" });
        const b = buildPreviewItem({ changeId: "change-2", playerNameSnapshot: "Bob" });

        expect(computePreviewFingerprint([a, b])).toBe(computePreviewFingerprint([b, a]));
    });

    it("changes when a row's requiresResolution flips, even with everything else equal", () => {
        const before = computePreviewFingerprint([buildPreviewItem({ requiresResolution: false })]);
        const after = computePreviewFingerprint([
            buildPreviewItem({ requiresResolution: true, defaultResolution: null, hasConflict: true }),
        ]);

        expect(before).not.toBe(after);
    });

    it("changes when a still-requiresResolution row's underlying evidence changes (e.g. a new dependency appears)", () => {
        const shared = { requiresResolution: true, defaultResolution: null, hasConflict: true } as const;
        const before = computePreviewFingerprint([buildPreviewItem({ ...shared, metricEntryCount: 0 })]);
        const after = computePreviewFingerprint([buildPreviewItem({ ...shared, metricEntryCount: 1 })]);

        expect(before).not.toBe(after);
    });

    it("is unaffected by liveSnapshot's raw field values — only the derived classification/evidence matters", () => {
        const a = computePreviewFingerprint([
            buildPreviewItem({ liveSnapshot: buildLiveMember({ id: "member-1", thp: 1000 }) }),
        ]);
        const b = computePreviewFingerprint([
            buildPreviewItem({ liveSnapshot: buildLiveMember({ id: "member-1", thp: 9999 }) }),
        ]);

        expect(a).toBe(b);
    });
});
