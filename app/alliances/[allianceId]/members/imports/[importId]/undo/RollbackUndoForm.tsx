"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/app/src/components";
import { Button, ConfirmDialog } from "@/app/src/components/client";
import { rollbackImport, type RollbackImportSummary, type RollbackResolutionChoice } from "./action";
import { ROLLBACK_RESOLUTION_LABELS } from "./resolutionLabels";
import { describeRollbackEvidence, pluralize } from "./describeRollbackEvidence";
import type { RollbackPreviewItem } from "../rollbackPreview";

export type RollbackUndoFormProps = {
    allianceId: string;
    importId: string;
    items: RollbackPreviewItem[];
    /** Opaque fingerprint of exactly this rendered preview (see
     * computePreviewFingerprint). Submitted as-is; rollbackImport rejects
     * the request if its own fresh recomputation doesn't match it exactly. */
    previewFingerprint: string;
};

/** Adapts a live preview item's shape to describeRollbackEvidence's shared
 * evidence contract — `currentlyArchived === null` is this preview's own
 * "member no longer exists" signal (see rollbackPreview.ts), equivalent to
 * a persisted result row's `memberMissing` column. */
function describeConflict(item: RollbackPreviewItem): string[] {
    return describeRollbackEvidence({
        memberMissing: item.currentlyArchived === null,
        driftedFields: item.driftedFields,
        hadLaterImportInvolvement: item.hadLaterImportInvolvement,
        hadLinkedUser: item.hadLinkedUser,
        metricEntryCount: item.metricEntryCount,
        leadershipNoteCount: item.leadershipNoteCount,
        invitationCount: item.invitationCount,
    });
}

export function RollbackUndoForm({ allianceId, importId, items, previewFingerprint }: RollbackUndoFormProps) {
    const router = useRouter();
    const [resolutions, setResolutions] = useState<Record<string, RollbackResolutionChoice>>({});
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [result, setResult] = useState<RollbackImportSummary | null>(null);
    const resultHeadingRef = useRef<HTMLHeadingElement>(null);

    const requiresResolutionItems = useMemo(() => items.filter((i) => i.requiresResolution), [items]);
    // No preselection (#277 PR 3 decision): every actionable conflict needs
    // an explicit choice recorded in `resolutions` before confirming is
    // possible — a missing entry, not a default value, is what "unresolved"
    // looks like here.
    const allResolved = requiresResolutionItems.every((i) => resolutions[i.changeId] !== undefined);

    const counts = useMemo(() => {
        const c = {
            deleted: 0,
            reverted: 0,
            retainedArchived: 0,
            skippedConflict: 0,
            needsInput: 0,
        };
        for (const item of items) {
            if (item.requiresResolution) {
                c.needsInput++;
            } else if (item.defaultResolution === "DELETED") {
                c.deleted++;
            } else if (item.defaultResolution === "REVERTED_TO_PRE_IMPORT_STATE") {
                c.reverted++;
            } else if (item.defaultResolution === "RETAINED_ARCHIVED") {
                c.retainedArchived++;
            } else {
                c.skippedConflict++;
            }
        }
        return c;
    }, [items]);

    useEffect(() => {
        if (result) {
            resultHeadingRef.current?.focus();
        }
    }, [result]);

    async function handleConfirm(): Promise<{ error?: string } | void> {
        const formData = new FormData();
        formData.set("allianceId", allianceId);
        formData.set("importId", importId);
        formData.set("previewFingerprint", previewFingerprint);
        for (const [changeId, choice] of Object.entries(resolutions)) {
            formData.set(`resolution:${changeId}`, choice);
        }

        const response = await rollbackImport(formData);
        if (!response.success) {
            return { error: response.error };
        }
        setResult(response);
        // Makes the next visit to this URL — and the detail page's own
        // eligibility check — reflect the now-committed rollback.
        router.refresh();
    }

    if (result) {
        const isFullyClean = result.outcome === "ROLLED_BACK";
        return (
            <div
                role="status"
                className={`rounded-lg border p-4 ${isFullyClean ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10"}`}
            >
                {/* tabIndex so a fully client-rendered success state (no page
                    navigation happened yet) can still receive focus for
                    screen-reader/keyboard users, matching the a11y bar the
                    rest of this app's post-mutation summaries hold to. */}
                <h2 ref={resultHeadingRef} tabIndex={-1} className="font-semibold text-text-primary outline-none">
                    {isFullyClean
                        ? "This import was fully undone."
                        : "This import was undone, but some members were retained."}
                </h2>
                <ul className="text-sm text-text-secondary mt-2 space-y-1 list-disc list-inside">
                    {result.deletedCount > 0 && <li>{pluralize(result.deletedCount, "member")} deleted</li>}
                    {result.revertedCount > 0 && <li>{pluralize(result.revertedCount, "member")} reverted</li>}
                    {result.retainedActiveCount > 0 && (
                        <li>{pluralize(result.retainedActiveCount, "member")} kept active</li>
                    )}
                    {result.archivedPreservingHistoryCount > 0 && (
                        <li>{pluralize(result.archivedPreservingHistoryCount, "member")} archived</li>
                    )}
                    {result.retainedArchivedCount > 0 && (
                        <li>{pluralize(result.retainedArchivedCount, "member")} retained, archived</li>
                    )}
                    {result.skippedConflictCount > 0 && (
                        <li>{pluralize(result.skippedConflictCount, "member")} skipped due to a conflict</li>
                    )}
                </ul>
            </div>
        );
    }

    const confirmDescription = (
        <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
            {counts.deleted > 0 && <li>{pluralize(counts.deleted, "member")} will be deleted.</li>}
            {counts.reverted > 0 && <li>{pluralize(counts.reverted, "member")} will be reverted.</li>}
            {counts.retainedArchived > 0 && (
                <li>{pluralize(counts.retainedArchived, "member")} will remain archived.</li>
            )}
            {counts.skippedConflict > 0 && (
                <li>{pluralize(counts.skippedConflict, "member")} will be left untouched due to a conflict.</li>
            )}
            {requiresResolutionItems.map((item) => (
                <li key={item.changeId}>
                    {item.playerNameSnapshot} will be{" "}
                    {resolutions[item.changeId] === "ARCHIVE_PRESERVING_HISTORY" ? "archived" : "kept active"}.
                </li>
            ))}
        </ul>
    );

    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <SummaryStat label="To delete" value={counts.deleted} />
                <SummaryStat label="To revert" value={counts.reverted} />
                <SummaryStat label="Needs your input" value={counts.needsInput} highlight={counts.needsInput > 0} />
                <SummaryStat
                    label="Conflicts (skipped)"
                    value={counts.retainedArchived + counts.skippedConflict}
                />
            </div>

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-secondary border-b border-border">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Player</th>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Change</th>
                                <th className="text-left px-4 py-3 font-medium text-text-secondary">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => (
                                <tr key={item.changeId} className="border-b border-border last:border-b-0 align-top">
                                    <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">
                                        {item.playerNameSnapshot}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge
                                            variant={item.changeType === "CREATED" ? "success" : "warning"}
                                            size="sm"
                                        >
                                            {item.changeType === "CREATED" ? "Created" : "Restored"}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-text-secondary">
                                        {item.requiresResolution ? (
                                            <fieldset>
                                                <legend className="sr-only">
                                                    Resolution for {item.playerNameSnapshot}
                                                </legend>
                                                <div className="flex flex-col gap-1">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="radio"
                                                            name={`resolution-${item.changeId}`}
                                                            value="RETAIN_ACTIVE"
                                                            checked={resolutions[item.changeId] === "RETAIN_ACTIVE"}
                                                            onChange={() =>
                                                                setResolutions((prev) => ({
                                                                    ...prev,
                                                                    [item.changeId]: "RETAIN_ACTIVE",
                                                                }))
                                                            }
                                                            className="w-4 h-4"
                                                        />
                                                        Keep active
                                                    </label>
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="radio"
                                                            name={`resolution-${item.changeId}`}
                                                            value="ARCHIVE_PRESERVING_HISTORY"
                                                            checked={
                                                                resolutions[item.changeId] ===
                                                                "ARCHIVE_PRESERVING_HISTORY"
                                                            }
                                                            onChange={() =>
                                                                setResolutions((prev) => ({
                                                                    ...prev,
                                                                    [item.changeId]: "ARCHIVE_PRESERVING_HISTORY",
                                                                }))
                                                            }
                                                            className="w-4 h-4"
                                                        />
                                                        Archive and preserve history
                                                    </label>
                                                </div>
                                                <ul className="mt-1 text-xs text-text-muted list-disc list-inside">
                                                    {describeConflict(item).map((reason, idx) => (
                                                        <li key={idx}>{reason}</li>
                                                    ))}
                                                </ul>
                                            </fieldset>
                                        ) : (
                                            <div>
                                                <span>
                                                    {ROLLBACK_RESOLUTION_LABELS[item.defaultResolution ?? ""] ??
                                                        item.defaultResolution}
                                                </span>
                                                {item.hasConflict && (
                                                    <ul className="mt-1 text-xs text-text-muted list-disc list-inside">
                                                        {describeConflict(item).map((reason, idx) => (
                                                            <li key={idx}>{reason}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <div className="flex justify-end mt-6">
                <Button variant="warning" disabled={!allResolved} onClick={() => setIsConfirmOpen(true)}>
                    Undo this import
                </Button>
            </div>

            <ConfirmDialog
                isOpen={isConfirmOpen}
                title="Undo this import?"
                description={confirmDescription}
                confirmLabel="Undo import"
                pendingLabel="Undoing…"
                confirmVariant="warning"
                onConfirm={handleConfirm}
                onClose={() => setIsConfirmOpen(false)}
            />
        </>
    );
}

function SummaryStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
    return (
        <div
            className={`border rounded-lg p-4 text-center ${highlight ? "border-warning/30 bg-warning/10" : "border-border bg-surface-secondary"}`}
        >
            <p className={`text-2xl font-bold ${highlight ? "text-warning" : "text-text-primary"}`}>{value}</p>
            <p className="text-sm text-text-secondary">{label}</p>
        </div>
    );
}
