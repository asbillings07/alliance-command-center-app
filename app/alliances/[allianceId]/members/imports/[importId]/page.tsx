import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import { PageLayout, Card, Badge } from "@/app/src/components";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
        importId: string;
    }>;
};

function formatDateTime(date: Date): string {
    return date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatThp(thp: number | null): string {
    return thp === null ? "—" : thp.toLocaleString("en-US");
}

function formatArchivedState(archivedAt: Date | null): string {
    return archivedAt === null ? "Active" : "Archived";
}

export default async function MemberImportDetailPage({ params }: Params) {
    const { allianceId, importId } = await params;

    // Read-only provenance is operational evidence, not destructive
    // authority: the same IMPORT_MEMBERS permission that gates running an
    // import also gates viewing its history (Admins and Owners).
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.IMPORT_MEMBERS,
    });

    // Scoped by both id and allianceId so an import ID from another alliance
    // 404s exactly like a nonexistent id — it never reveals whether the
    // record exists elsewhere.
    const memberImport = await prisma.memberImport.findFirst({
        where: { id: importId, allianceId },
        select: {
            id: true,
            fileName: true,
            sourceSheetName: true,
            actorEmailSnapshot: true,
            actorDisplayNameSnapshot: true,
            createdAt: true,
            createdCount: true,
            restoredCount: true,
            skippedExistingCount: true,
            skippedDuplicateCount: true,
            skippedEmptyNameCount: true,
            skippedUnselectedCount: true,
            changes: {
                orderBy: [{ sourceRow: "asc" }, { id: "asc" }],
                select: {
                    id: true,
                    playerNameSnapshot: true,
                    sourceRow: true,
                    changeType: true,
                    archivedAtBefore: true,
                    archivedAtAfter: true,
                    thpBefore: true,
                    thpAfter: true,
                    roleBefore: true,
                    roleAfter: true,
                    allianceMemberId: true,
                },
            },
        },
    });

    if (!memberImport) {
        notFound();
    }

    const skippedTotal =
        memberImport.skippedExistingCount +
        memberImport.skippedDuplicateCount +
        memberImport.skippedEmptyNameCount +
        memberImport.skippedUnselectedCount;

    const detailLabel = memberImport.fileName ?? formatDateTime(memberImport.createdAt);

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Members", href: `/alliances/${allianceId}/members` },
                { label: "Import history", href: `/alliances/${allianceId}/members/imports` },
                { label: detailLabel },
            ]}
            title={memberImport.fileName ?? "Roster Import"}
            description={`Imported by ${memberImport.actorDisplayNameSnapshot ?? memberImport.actorEmailSnapshot} on ${formatDateTime(memberImport.createdAt)}${memberImport.sourceSheetName ? ` · Sheet: ${memberImport.sourceSheetName}` : ""}`}
        >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-success">{memberImport.createdCount}</p>
                    <p className="text-sm text-text-secondary">Created</p>
                </div>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-warning">{memberImport.restoredCount}</p>
                    <p className="text-sm text-text-secondary">Restored</p>
                </div>
                <div className="bg-surface-secondary border border-border rounded-lg p-4 text-center col-span-2 sm:col-span-1">
                    <p className="text-2xl font-bold text-text-muted">{skippedTotal}</p>
                    <p className="text-sm text-text-secondary">Skipped</p>
                </div>
                <div className="bg-surface-secondary border border-border rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-text-primary">{memberImport.changes.length}</p>
                    <p className="text-sm text-text-secondary">Members affected</p>
                </div>
            </div>

            {skippedTotal > 0 && (
                <div className="bg-surface-secondary border border-border rounded-lg p-4 mb-6">
                    <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-2">
                        Skip breakdown
                    </h3>
                    <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
                        {memberImport.skippedExistingCount > 0 && (
                            <li>
                                <strong>{memberImport.skippedExistingCount}</strong> already existing active members
                            </li>
                        )}
                        {memberImport.skippedDuplicateCount > 0 && (
                            <li>
                                <strong>{memberImport.skippedDuplicateCount}</strong> duplicate rows in file
                            </li>
                        )}
                        {memberImport.skippedEmptyNameCount > 0 && (
                            <li>
                                <strong>{memberImport.skippedEmptyNameCount}</strong> rows with empty player names
                            </li>
                        )}
                        {memberImport.skippedUnselectedCount > 0 && (
                            <li>
                                <strong>{memberImport.skippedUnselectedCount}</strong> rows unselected during review
                            </li>
                        )}
                    </ul>
                </div>
            )}

            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-3">
                Members Affected
            </h3>
            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-secondary border-b border-border">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Player</th>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Change</th>
                                <th className="text-right px-4 py-3 font-medium text-text-secondary">THP</th>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Role</th>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {memberImport.changes.map((change) => (
                                <tr key={change.id} className="border-b border-border last:border-b-0">
                                    <td className="px-4 py-3">
                                        {change.allianceMemberId ? (
                                            <Link
                                                href={`/alliances/${allianceId}/members/${change.allianceMemberId}`}
                                                className="font-medium text-primary-light hover:text-primary"
                                            >
                                                {change.playerNameSnapshot}
                                            </Link>
                                        ) : (
                                            <span className="font-medium text-text-primary">
                                                {change.playerNameSnapshot}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge
                                            variant={change.changeType === MemberImportChangeType.CREATED ? "success" : "warning"}
                                            size="sm"
                                        >
                                            {change.changeType === MemberImportChangeType.CREATED ? "Created" : "Restored"}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-right text-text-secondary whitespace-nowrap">
                                        {change.changeType === MemberImportChangeType.RESTORED &&
                                        change.thpBefore !== change.thpAfter ? (
                                            <span>
                                                <span className="text-text-muted line-through mr-1">
                                                    {formatThp(change.thpBefore)}
                                                </span>
                                                {formatThp(change.thpAfter)}
                                            </span>
                                        ) : (
                                            formatThp(change.thpAfter)
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-text-secondary">
                                        {change.changeType === MemberImportChangeType.RESTORED &&
                                        change.roleBefore !== change.roleAfter ? (
                                            <span>
                                                <span className="text-text-muted line-through mr-1">
                                                    {change.roleBefore ?? "—"}
                                                </span>
                                                {change.roleAfter ?? "—"}
                                            </span>
                                        ) : (
                                            change.roleAfter ?? "—"
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-text-secondary">
                                        {change.changeType === MemberImportChangeType.RESTORED
                                            ? `${formatArchivedState(change.archivedAtBefore)} → ${formatArchivedState(change.archivedAtAfter)}`
                                            : formatArchivedState(change.archivedAtAfter)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </PageLayout>
    );
}
