import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";
import { PageLayout, Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { formatImportTimestamp } from "@/app/src/lib/format/formatImportTimestamp";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
        importId: string;
    }>;
};

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
    const auth = await requireAllianceAccess({
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
            mode: true,
            createdCount: true,
            createdArchivedCount: true,
            restoredCount: true,
            skippedExistingCount: true,
            skippedDuplicateCount: true,
            skippedEmptyNameCount: true,
            skippedUnselectedCount: true,
            skippedLifecycleConflictCount: true,
            rollback: { select: { id: true } },
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
        memberImport.skippedUnselectedCount +
        memberImport.skippedLifecycleConflictCount;

    const isHistorical = memberImport.mode === "HISTORICAL";
    const detailLabel = memberImport.fileName;

    return (
        <PageLayout
            breadcrumb={[
                { label: "Dashboard", href: `/alliances/${allianceId}` },
                { label: "Members", href: `/alliances/${allianceId}/members` },
                { label: "Import history", href: `/alliances/${allianceId}/members/imports` },
                { label: detailLabel },
            ]}
            title={memberImport.fileName}
            description={`Imported by ${memberImport.actorDisplayNameSnapshot ?? memberImport.actorEmailSnapshot} on ${formatImportTimestamp(memberImport.createdAt)} · Sheet: ${memberImport.sourceSheetName}`}
            action={
                // Owner-only (ROLLBACK_MEMBER_IMPORTS, #277 PR 3) — undoing an
                // import is a more destructive, harder-to-reverse action than
                // running one, so it isn't gated by the same IMPORT_MEMBERS
                // permission the rest of this page uses. The link always goes
                // to /undo, whether or not this import has already been
                // rolled back — that route owns both the interactive preview
                // and the durable "already undone" result.
                auth.permissions.canRollbackMemberImports && (
                    <Button
                        variant="secondary"
                        size="sm"
                        href={`/alliances/${allianceId}/members/imports/${importId}/undo`}
                    >
                        {memberImport.rollback ? "View undo result" : "Undo import"}
                    </Button>
                )
            }
        >
            {isHistorical && (
                <div className="mb-4">
                    <Badge variant="info" size="sm">
                        Historical Roster Import
                    </Badge>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-success">{memberImport.createdCount}</p>
                    <p className="text-sm text-text-secondary">
                        Created
                        {memberImport.createdArchivedCount > 0 && (
                            <span className="block text-xs text-text-muted">
                                {memberImport.createdArchivedCount} archived
                            </span>
                        )}
                    </p>
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
                        {memberImport.skippedLifecycleConflictCount > 0 && (
                            <li>
                                <strong>{memberImport.skippedLifecycleConflictCount}</strong> existing active members
                                requested Archived were left active (never auto-archived)
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
                                            {change.changeType === MemberImportChangeType.CREATED
                                                ? change.archivedAtAfter
                                                    ? "Created (Archived)"
                                                    : "Created"
                                                : "Restored"}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-right text-text-secondary whitespace-nowrap">
                                        {change.changeType === MemberImportChangeType.RESTORED &&
                                        change.thpBefore !== change.thpAfter ? (
                                            // Line-through is a visual-only cue; a screen reader
                                            // (and anyone who can't perceive the strikethrough)
                                            // still needs explicit "from → to" text. A visually
                                            // hidden real text node (not aria-label — axe's
                                            // aria-prohibited-attr rule rejects aria-label on a
                                            // plain <span>'s implicit "generic" role) carries that
                                            // for assistive tech, while the visual pair stays
                                            // aria-hidden to avoid announcing the values twice.
                                            <span>
                                                <span className="sr-only">
                                                    {`changed from ${formatThp(change.thpBefore)} to ${formatThp(change.thpAfter)}`}
                                                </span>
                                                <span aria-hidden="true">
                                                    <span className="text-text-muted line-through mr-1">
                                                        {formatThp(change.thpBefore)}
                                                    </span>
                                                    {formatThp(change.thpAfter)}
                                                </span>
                                            </span>
                                        ) : (
                                            formatThp(change.thpAfter)
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-text-secondary">
                                        {change.changeType === MemberImportChangeType.RESTORED &&
                                        change.roleBefore !== change.roleAfter ? (
                                            <span>
                                                <span className="sr-only">
                                                    {`changed from ${change.roleBefore ?? "none"} to ${change.roleAfter ?? "none"}`}
                                                </span>
                                                <span aria-hidden="true">
                                                    <span className="text-text-muted line-through mr-1">
                                                        {change.roleBefore ?? "—"}
                                                    </span>
                                                    {change.roleAfter ?? "—"}
                                                </span>
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
