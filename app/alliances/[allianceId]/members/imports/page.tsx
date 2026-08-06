import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PageLayout, Card, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { formatImportTimestamp } from "@/app/src/lib/format/formatImportTimestamp";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
    }>;
    searchParams: Promise<{
        page?: string;
    }>;
};

export const PAGE_SIZE = 25;

/**
 * Clamps a raw `?page=` query param to a real page number.
 *
 * Non-numeric, missing, or out-of-range values collapse to page 1 (or the
 * last real page when the request is beyond it) rather than a 500 or a
 * silently empty page — mirrors clampRequestedPage/resolvePageAgainstTotal
 * in getMetricSummaryReport.ts.
 */
export function resolveImportHistoryPage(rawPage: string | undefined, totalPages: number): number {
    const parsed = rawPage !== undefined ? Number(rawPage) : 1;
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return Math.min(Math.floor(parsed), Math.max(1, totalPages));
}

export default async function MemberImportHistoryPage({ params, searchParams }: Params) {
    const { allianceId } = await params;
    const { page: rawPage } = await searchParams;

    // Read-only provenance is operational evidence, not destructive
    // authority: the same IMPORT_MEMBERS permission that gates running an
    // import also gates viewing its history (Admins and Owners).
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.IMPORT_MEMBERS,
    });

    const totalCount = await prisma.memberImport.count({ where: { allianceId } });
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = resolveImportHistoryPage(rawPage, totalPages);

    const imports = await prisma.memberImport.findMany({
        where: { allianceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
            id: true,
            fileName: true,
            sourceSheetName: true,
            actorEmailSnapshot: true,
            actorDisplayNameSnapshot: true,
            createdAt: true,
            mode: true,
            createdCount: true,
            createdArchivedCount: true,
            restoredCount: true,
            skippedExistingCount: true,
            skippedDuplicateCount: true,
            skippedEmptyNameCount: true,
            skippedUnselectedCount: true,
            skippedLifecycleConflictCount: true,
        },
    });

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Members", href: `/alliances/${allianceId}/members` },
                { label: "Import history" },
            ]}
            title="Import History"
            description={`${totalCount} roster import${totalCount === 1 ? "" : "s"}`}
            action={
                <Button variant="secondary" size="sm" href={`/alliances/${allianceId}/members/import`}>
                    Import Members
                </Button>
            }
        >
            {imports.length === 0 ? (
                <EmptyState
                    title="No imports yet"
                    description="Once you import a roster spreadsheet that creates or restores at least one member, it will appear here."
                    action={
                        <Button variant="primary" href={`/alliances/${allianceId}/members/import`}>
                            Import Members
                        </Button>
                    }
                />
            ) : (
                <>
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-surface-secondary border-b border-border">
                                    <tr>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                            File
                                        </th>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                            Imported by
                                        </th>
                                        <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                            Date
                                        </th>
                                        <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                            Created
                                        </th>
                                        <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                            Restored
                                        </th>
                                        <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                            Skipped
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {imports.map((imp) => {
                                        const skippedTotal =
                                            imp.skippedExistingCount +
                                            imp.skippedDuplicateCount +
                                            imp.skippedEmptyNameCount +
                                            imp.skippedUnselectedCount +
                                            imp.skippedLifecycleConflictCount;
                                        const detailHref = `/alliances/${allianceId}/members/imports/${imp.id}`;
                                        const actorLabel = imp.actorDisplayNameSnapshot ?? imp.actorEmailSnapshot;
                                        const isHistorical = imp.mode === "HISTORICAL";

                                        return (
                                            <tr
                                                key={imp.id}
                                                className="relative border-b border-border hover:bg-surface-secondary transition-colors"
                                            >
                                                <td className="p-0">
                                                    {/*
                                                        Exactly one real link per row ("stretched
                                                        link" pattern): its ::before is absolutely
                                                        positioned against this <tr> (relative
                                                        above), covering the whole row so a mouse
                                                        click anywhere still navigates, while
                                                        keyboard/screen-reader users only encounter
                                                        one tab stop instead of six redundant links
                                                        to the same destination. The other cells
                                                        below are plain, non-interactive text.
                                                    */}
                                                    <Link
                                                        href={detailHref}
                                                        className="block px-4 py-3 font-medium text-primary-light hover:text-primary before:absolute before:inset-0 before:content-['']"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            {imp.fileName}
                                                            {isHistorical && (
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary/20 text-primary-light">
                                                                    Historical Roster
                                                                </span>
                                                            )}
                                                        </span>
                                                        {imp.sourceSheetName && (
                                                            <span className="block text-xs font-normal text-text-muted">
                                                                {imp.sourceSheetName}
                                                            </span>
                                                        )}
                                                    </Link>
                                                </td>
                                                <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                                                    {actorLabel}
                                                </td>
                                                <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                                                    {formatImportTimestamp(imp.createdAt)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-medium text-success whitespace-nowrap">
                                                    {imp.createdCount}
                                                    {imp.createdArchivedCount > 0 && (
                                                        <span className="block text-xs font-normal text-text-muted">
                                                            {imp.createdArchivedCount} archived
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right font-medium text-warning whitespace-nowrap">
                                                    {imp.restoredCount}
                                                </td>
                                                <td className="px-4 py-3 text-right text-text-muted whitespace-nowrap">
                                                    {skippedTotal}
                                                    {imp.skippedLifecycleConflictCount > 0 && (
                                                        <span className="block text-xs font-normal text-text-muted">
                                                            {imp.skippedLifecycleConflictCount} conflict
                                                            {imp.skippedLifecycleConflictCount === 1 ? "" : "s"}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between gap-3 mt-4 text-sm text-text-muted">
                            <span>
                                Page {page} of {totalPages}
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={page <= 1}
                                    href={`/alliances/${allianceId}/members/imports?page=${page - 1}`}
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={page >= totalPages}
                                    href={`/alliances/${allianceId}/members/imports?page=${page + 1}`}
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </PageLayout>
    );
}
