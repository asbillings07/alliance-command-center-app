import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { PageLayout, Card } from "@/app/src/components";
import { formatImportTimestamp } from "@/app/src/lib/format/formatImportTimestamp";
import { computeImportRollbackPreview, computePreviewFingerprint } from "../rollbackPreview";
import { RollbackUndoForm } from "./RollbackUndoForm";
import { ROLLBACK_RESOLUTION_LABELS } from "./resolutionLabels";
import { describeRollbackEvidence } from "./describeRollbackEvidence";

type Params = {
    params: Promise<{
        allianceId: string;
        importId: string;
    }>;
};

/** Read-only, durable view of a rollback that already happened — reached
 * either by revisiting this URL later or immediately after a successful
 * commit (see RollbackUndoForm, which shows its own instant summary from
 * the action's return value and then this same view takes over on
 * navigation/refresh). */
async function AlreadyRolledBackSummary({ rollbackId }: { rollbackId: string }) {
    const rollback = await prisma.memberImportRollback.findUnique({
        where: { id: rollbackId },
        select: {
            outcome: true,
            createdAt: true,
            actorEmailSnapshot: true,
            actorDisplayNameSnapshot: true,
            deletedCount: true,
            revertedCount: true,
            retainedActiveCount: true,
            archivedPreservingHistoryCount: true,
            retainedArchivedCount: true,
            skippedConflictCount: true,
            results: {
                select: {
                    resolution: true,
                    memberMissing: true,
                    driftedFields: true,
                    hadLaterImportInvolvement: true,
                    hadLinkedUser: true,
                    metricEntryCount: true,
                    leadershipNoteCount: true,
                    invitationCount: true,
                    memberImportChange: {
                        select: { playerNameSnapshot: true, sourceRow: true, changeType: true },
                    },
                },
                orderBy: { memberImportChange: { sourceRow: "asc" } },
            },
        },
    });

    if (!rollback) {
        notFound();
    }

    const actorLabel = rollback.actorDisplayNameSnapshot ?? rollback.actorEmailSnapshot;
    const isFullyClean = rollback.outcome === "ROLLED_BACK";

    return (
        <>
            <div
                className={`rounded-lg border p-4 mb-6 ${isFullyClean ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10"}`}
            >
                <p className="font-semibold text-text-primary">
                    {isFullyClean
                        ? "This import was fully undone."
                        : "This import was undone, but some members were retained."}
                </p>
                <p className="text-sm text-text-secondary mt-1">
                    By {actorLabel} on {formatImportTimestamp(rollback.createdAt)}
                </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                <SummaryStat label="Deleted" value={rollback.deletedCount} />
                <SummaryStat label="Reverted" value={rollback.revertedCount} />
                <SummaryStat label="Kept active" value={rollback.retainedActiveCount} />
                <SummaryStat label="Archived" value={rollback.archivedPreservingHistoryCount} />
                <SummaryStat label="Retained archived" value={rollback.retainedArchivedCount} />
                <SummaryStat label="Skipped (conflict)" value={rollback.skippedConflictCount} />
            </div>

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-secondary border-b border-border">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Player</th>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rollback.results.map((r, idx) => {
                                // The two clean resolutions never had a
                                // conflict to explain; every other
                                // resolution exists *because* of one — see
                                // computeImportRollbackPreview's own
                                // requiresResolution/defaultResolution
                                // branches for why those two are the only
                                // conflict-free outcomes.
                                const isClean =
                                    r.resolution === "DELETED" || r.resolution === "REVERTED_TO_PRE_IMPORT_STATE";
                                const reasons = isClean ? [] : describeRollbackEvidence(r);
                                return (
                                    <tr key={idx} className="border-b border-border last:border-b-0 align-top">
                                        <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">
                                            {r.memberImportChange.playerNameSnapshot}
                                        </td>
                                        <td className="px-4 py-3 text-text-secondary">
                                            <span>{ROLLBACK_RESOLUTION_LABELS[r.resolution] ?? r.resolution}</span>
                                            {reasons.length > 0 && (
                                                <ul className="mt-1 text-xs text-text-muted list-disc list-inside">
                                                    {reasons.map((reason, reasonIdx) => (
                                                        <li key={reasonIdx}>{reason}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        </>
    );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-surface-secondary border border-border rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{value}</p>
            <p className="text-sm text-text-secondary">{label}</p>
        </div>
    );
}

export default async function UndoImportPage({ params }: Params) {
    const { allianceId, importId } = await params;

    // Owner-only: undoing an import is a more destructive, harder-to-reverse
    // action than running one — deliberately its own capability, not
    // IMPORT_MEMBERS/MANAGE_MEMBERS (see permissions.ts).
    await requireAllianceAccess({
        allianceId,
        requiredPermission: Permissions.ROLLBACK_MEMBER_IMPORTS,
    });

    const memberImport = await prisma.memberImport.findFirst({
        where: { id: importId, allianceId },
        select: {
            id: true,
            createdAt: true,
            fileName: true,
            rollback: { select: { id: true } },
            changes: {
                orderBy: [{ sourceRow: "asc" }, { id: "asc" }],
                select: {
                    id: true,
                    memberImportId: true,
                    allianceMemberId: true,
                    playerNameSnapshot: true,
                    sourceRow: true,
                    changeType: true,
                    archivedAtBefore: true,
                    archivedAtAfter: true,
                    thpBefore: true,
                    thpAfter: true,
                    roleBefore: true,
                    roleAfter: true,
                    discordNameAfter: true,
                    squadPowerAfter: true,
                    joinedAtAfter: true,
                    userIdAfter: true,
                    memberUpdatedAtAfter: true,
                },
            },
        },
    });

    if (!memberImport) {
        notFound();
    }

    const breadcrumb = [
        { label: "Dashboard", href: `/alliances/${allianceId}` },
        { label: "Members", href: `/alliances/${allianceId}/members` },
        { label: "Import history", href: `/alliances/${allianceId}/members/imports` },
        { label: memberImport.fileName, href: `/alliances/${allianceId}/members/imports/${importId}` },
        { label: "Undo" },
    ];

    if (memberImport.rollback) {
        return (
            <PageLayout breadcrumb={breadcrumb} title={`Undo: ${memberImport.fileName}`}>
                <AlreadyRolledBackSummary rollbackId={memberImport.rollback.id} />
            </PageLayout>
        );
    }

    // Read-only preview: no lock needed here, since rollbackImport
    // recomputes this exact same classification fresh inside its own
    // transaction immediately before committing (see computeImportRollbackPreview's
    // doc comment) — this render is only ever a suggestion to the owner.
    const preview = await computeImportRollbackPreview(prisma, memberImport, memberImport.changes);
    // Bound to *this* rendered preview, not to the resolutions the owner
    // picks — see computePreviewFingerprint's doc comment. rollbackImport
    // rejects the submission outright if its own fresh recomputation
    // doesn't produce this exact same fingerprint.
    const previewFingerprint = computePreviewFingerprint(preview.items);

    return (
        <PageLayout
            breadcrumb={breadcrumb}
            title={`Undo: ${memberImport.fileName}`}
            description={`Imported ${formatImportTimestamp(memberImport.createdAt)}`}
        >
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 mb-6">
                <p className="font-semibold text-text-primary">This cannot be undone once confirmed.</p>
                <p className="text-sm text-text-secondary mt-1">
                    Members this import created will be deleted. Members it restored will be re-archived and have
                    their pre-import THP/role put back. Any member with a conflicting edit since this import will be
                    left completely untouched.
                </p>
            </div>

            <RollbackUndoForm
                allianceId={allianceId}
                importId={importId}
                items={preview.items}
                previewFingerprint={previewFingerprint}
            />
        </PageLayout>
    );
}
