import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
        React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
    notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
    }),
}));

vi.mock("@/app/src/lib/auth", () => ({}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn().mockResolvedValue({
        permissions: { canImportMembers: true },
    }),
}));

vi.mock("@/app/src/lib/prisma", () => ({
    prisma: {
        memberImport: {
            findFirst: vi.fn(),
        },
    },
}));

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import MemberImportDetailPage from "./page";

function baseMemberImport(overrides: Partial<Awaited<ReturnType<typeof prisma.memberImport.findFirst>>> = {}) {
    return {
        id: "imp_1",
        fileName: "august-roster.xlsx",
        sourceSheetName: "Roster",
        actorEmailSnapshot: "leader@example.com",
        actorDisplayNameSnapshot: "Leader One",
        createdAt: new Date("2026-08-01T12:00:00Z"),
        createdCount: 1,
        restoredCount: 0,
        skippedExistingCount: 0,
        skippedDuplicateCount: 0,
        skippedEmptyNameCount: 0,
        skippedUnselectedCount: 0,
        changes: [],
        ...overrides,
    } as unknown as Awaited<ReturnType<typeof prisma.memberImport.findFirst>>;
}

describe("MemberImportDetailPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            permissions: { canImportMembers: true },
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    });

    it("requires the IMPORT_MEMBERS permission", async () => {
        vi.mocked(prisma.memberImport.findFirst).mockResolvedValue(baseMemberImport());

        await MemberImportDetailPage({
            params: Promise.resolve({ allianceId: "all_1", importId: "imp_1" }),
        });

        expect(requireAllianceAccess).toHaveBeenCalledWith({
            allianceId: "all_1",
            requiredPermission: Permissions.IMPORT_MEMBERS,
        });
    });

    it("scopes the query by both id and allianceId, so a cross-tenant id 404s", async () => {
        vi.mocked(prisma.memberImport.findFirst).mockResolvedValue(null);

        await expect(
            MemberImportDetailPage({
                params: Promise.resolve({ allianceId: "all_1", importId: "imp_from_other_alliance" }),
            })
        ).rejects.toThrow("NEXT_NOT_FOUND");

        expect(prisma.memberImport.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "imp_from_other_alliance", allianceId: "all_1" },
            })
        );
    });

    it("renders the breadcrumb using the file name and links back to the history list", async () => {
        vi.mocked(prisma.memberImport.findFirst).mockResolvedValue(baseMemberImport());

        const page = await MemberImportDetailPage({
            params: Promise.resolve({ allianceId: "all_1", importId: "imp_1" }),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("august-roster.xlsx");
        expect(html).toContain('href="/alliances/all_1/members/imports"');
        expect(html).toContain("Leader One");
    });

    it("orders changes by sourceRow ascending and does not render any rollback control", async () => {
        vi.mocked(prisma.memberImport.findFirst).mockResolvedValue(
            baseMemberImport({
                createdCount: 1,
                restoredCount: 1,
                changes: [
                    {
                        id: "chg_1",
                        playerNameSnapshot: "New Player",
                        sourceRow: 1,
                        changeType: "CREATED",
                        archivedAtBefore: null,
                        archivedAtAfter: null,
                        thpBefore: null,
                        thpAfter: 50000,
                        roleBefore: null,
                        roleAfter: "R4",
                        allianceMemberId: "mem_new",
                    },
                    {
                        id: "chg_2",
                        playerNameSnapshot: "Restored Player",
                        sourceRow: 2,
                        changeType: "RESTORED",
                        archivedAtBefore: new Date("2026-07-01T00:00:00Z"),
                        archivedAtAfter: null,
                        thpBefore: 10000,
                        thpAfter: 20000,
                        roleBefore: "R2",
                        roleAfter: "R3",
                        allianceMemberId: "mem_restored",
                    },
                ],
            } as never)
        );

        const page = await MemberImportDetailPage({
            params: Promise.resolve({ allianceId: "all_1", importId: "imp_1" }),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("New Player");
        expect(html).toContain("Restored Player");
        expect(html).toContain("Created");
        expect(html).toContain("Restored");
        expect(html).toContain('href="/alliances/all_1/members/mem_new"');
        expect(html).toContain('href="/alliances/all_1/members/mem_restored"');

        // Restored change shows a real before -> after diff for changed fields.
        expect(html).toContain("10,000");
        expect(html).toContain("20,000");
        expect(html).toContain("Archived");
        expect(html).toContain("Active");

        // PR 1 must never show any rollback affordance.
        expect(html.toLowerCase()).not.toContain("rollback");
        expect(html.toLowerCase()).not.toContain("undo");

        expect(prisma.memberImport.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                select: expect.objectContaining({
                    changes: expect.objectContaining({
                        orderBy: [{ sourceRow: "asc" }, { id: "asc" }],
                    }),
                }),
            })
        );
    });

    it("renders the skip breakdown only for nonzero categories", async () => {
        vi.mocked(prisma.memberImport.findFirst).mockResolvedValue(
            baseMemberImport({
                skippedExistingCount: 3,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 2,
                skippedUnselectedCount: 0,
            })
        );

        const page = await MemberImportDetailPage({
            params: Promise.resolve({ allianceId: "all_1", importId: "imp_1" }),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("already existing active members");
        expect(html).toContain("rows with empty player names");
        expect(html).not.toContain("duplicate rows in file");
        expect(html).not.toContain("rows unselected during review");
    });

    it("renders a plain player name (no member link) when the member row no longer exists", async () => {
        vi.mocked(prisma.memberImport.findFirst).mockResolvedValue(
            baseMemberImport({
                changes: [
                    {
                        id: "chg_1",
                        playerNameSnapshot: "Deleted Member",
                        sourceRow: 1,
                        changeType: "CREATED",
                        archivedAtBefore: null,
                        archivedAtAfter: null,
                        thpBefore: null,
                        thpAfter: null,
                        roleBefore: null,
                        roleAfter: null,
                        allianceMemberId: null,
                    },
                ],
            } as never)
        );

        const page = await MemberImportDetailPage({
            params: Promise.resolve({ allianceId: "all_1", importId: "imp_1" }),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("Deleted Member");
        expect(html).not.toContain('href="/alliances/all_1/members/null"');
    });
});
