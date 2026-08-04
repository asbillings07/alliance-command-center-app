import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
        React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
    redirect: vi.fn((path: string) => {
        throw new Error(`REDIRECT:${path}`);
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
            count: vi.fn(),
            findMany: vi.fn(),
        },
    },
}));

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import MemberImportHistoryPage, { resolveImportHistoryPage, PAGE_SIZE } from "./page";

describe("resolveImportHistoryPage", () => {
    it("defaults to page 1 when the raw param is missing", () => {
        expect(resolveImportHistoryPage(undefined, 5)).toBe(1);
    });

    it("defaults to page 1 when the raw param is non-numeric", () => {
        expect(resolveImportHistoryPage("not-a-number", 5)).toBe(1);
    });

    it("defaults to page 1 when the raw param is zero or negative", () => {
        expect(resolveImportHistoryPage("0", 5)).toBe(1);
        expect(resolveImportHistoryPage("-3", 5)).toBe(1);
    });

    it("floors a fractional page number", () => {
        expect(resolveImportHistoryPage("2.9", 5)).toBe(2);
    });

    it("clamps a page beyond the last real page down to totalPages", () => {
        expect(resolveImportHistoryPage("99", 5)).toBe(5);
    });

    it("clamps to page 1 when there are no pages at all (totalPages defensively floors to 1)", () => {
        expect(resolveImportHistoryPage("3", 0)).toBe(1);
    });
});

describe("MemberImportHistoryPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requireAllianceAccess).mockResolvedValue({
            permissions: { canImportMembers: true },
        } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    });

    it("requires the IMPORT_MEMBERS permission, scoped to the current alliance", async () => {
        vi.mocked(prisma.memberImport.count).mockResolvedValue(0);
        vi.mocked(prisma.memberImport.findMany).mockResolvedValue([]);

        await MemberImportHistoryPage({
            params: Promise.resolve({ allianceId: "all_1" }),
            searchParams: Promise.resolve({}),
        });

        expect(requireAllianceAccess).toHaveBeenCalledWith({
            allianceId: "all_1",
            requiredPermission: Permissions.IMPORT_MEMBERS,
        });
    });

    it("renders an empty state with an Import Members action when there is no history", async () => {
        vi.mocked(prisma.memberImport.count).mockResolvedValue(0);
        vi.mocked(prisma.memberImport.findMany).mockResolvedValue([]);

        const page = await MemberImportHistoryPage({
            params: Promise.resolve({ allianceId: "all_1" }),
            searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("No imports yet");
        expect(html).toContain('href="/alliances/all_1/members/import"');
        expect(html).toContain("Dashboard");
        expect(html).toContain("Import history");
    });

    it("renders each import row with file, actor, and count columns linking to its detail page", async () => {
        vi.mocked(prisma.memberImport.count).mockResolvedValue(1);
        vi.mocked(prisma.memberImport.findMany).mockResolvedValue([
            {
                id: "imp_1",
                fileName: "august-roster.xlsx",
                sourceSheetName: "Roster",
                actorEmailSnapshot: "leader@example.com",
                actorDisplayNameSnapshot: "Leader One",
                createdAt: new Date("2026-08-01T12:00:00Z"),
                createdCount: 5,
                restoredCount: 2,
                skippedExistingCount: 1,
                skippedDuplicateCount: 1,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 1,
            },
        ] as unknown as Awaited<ReturnType<typeof prisma.memberImport.findMany>>);

        const page = await MemberImportHistoryPage({
            params: Promise.resolve({ allianceId: "all_1" }),
            searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("august-roster.xlsx");
        expect(html).toContain("Roster");
        expect(html).toContain("Leader One");
        expect(html).toContain('href="/alliances/all_1/members/imports/imp_1"');
        // 5 created, 2 restored, 3 skipped total (1+1+0+1)
        expect(html).toContain(">5<");
        expect(html).toContain(">2<");
        expect(html).toContain(">3<");
    });

    it("falls back to the actor email when no display name snapshot is present", async () => {
        vi.mocked(prisma.memberImport.count).mockResolvedValue(1);
        vi.mocked(prisma.memberImport.findMany).mockResolvedValue([
            {
                id: "imp_1",
                fileName: "roster.csv",
                sourceSheetName: null,
                actorEmailSnapshot: "leader@example.com",
                actorDisplayNameSnapshot: null,
                createdAt: new Date("2026-08-01T12:00:00Z"),
                createdCount: 1,
                restoredCount: 0,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
            },
        ] as unknown as Awaited<ReturnType<typeof prisma.memberImport.findMany>>);

        const page = await MemberImportHistoryPage({
            params: Promise.resolve({ allianceId: "all_1" }),
            searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("leader@example.com");
    });

    it("queries in deterministic order (createdAt desc, id desc) with a fixed page size", async () => {
        vi.mocked(prisma.memberImport.count).mockResolvedValue(0);
        vi.mocked(prisma.memberImport.findMany).mockResolvedValue([]);

        await MemberImportHistoryPage({
            params: Promise.resolve({ allianceId: "all_1" }),
            searchParams: Promise.resolve({}),
        });

        expect(prisma.memberImport.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { allianceId: "all_1" },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: 0,
                take: PAGE_SIZE,
            })
        );
    });

    it("renders Previous/Next pagination controls with clamped, correct hrefs", async () => {
        vi.mocked(prisma.memberImport.count).mockResolvedValue(PAGE_SIZE * 3);
        vi.mocked(prisma.memberImport.findMany).mockResolvedValue([
            {
                id: "imp_2",
                fileName: "roster.csv",
                sourceSheetName: null,
                actorEmailSnapshot: "leader@example.com",
                actorDisplayNameSnapshot: null,
                createdAt: new Date("2026-08-01T12:00:00Z"),
                createdCount: 1,
                restoredCount: 0,
                skippedExistingCount: 0,
                skippedDuplicateCount: 0,
                skippedEmptyNameCount: 0,
                skippedUnselectedCount: 0,
            },
        ] as unknown as Awaited<ReturnType<typeof prisma.memberImport.findMany>>);

        const page = await MemberImportHistoryPage({
            params: Promise.resolve({ allianceId: "all_1" }),
            searchParams: Promise.resolve({ page: "2" }),
        });
        const html = renderToStaticMarkup(page);

        expect(html).toContain("Page 2 of 3");
        expect(prisma.memberImport.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ skip: PAGE_SIZE }),
        );
        expect(html).toContain('href="/alliances/all_1/members/imports?page=1"');
        expect(html).toContain('href="/alliances/all_1/members/imports?page=3"');
    });
});
