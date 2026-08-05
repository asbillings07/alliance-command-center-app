"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge } from "@/app/src/components";
import { Button, ConfirmDialog } from "@/app/src/components/client";
import { formatPower } from "@/app/src/lib/formatPower";
import { getAvailableMemberCapacity, getMemberCapacityError } from "@/app/src/lib/memberCapacity";
import { bulkArchiveMembers, bulkRestoreMembers } from "./bulk-actions";

type FilterType = "active" | "archived" | "all";

type PeriodMetricColumn = {
    metricId: string;
    metricName: string;
};

export type MembersTableMember = {
    id: string;
    playerName: string;
    archivedAt: Date | null;
    thp: number | null;
    squadPower: number | null;
    role: string | null;
};

export type MembersTableProps = {
    allianceId: string;
    filter: FilterType;
    members: MembersTableMember[];
    periodMetricColumns: PeriodMetricColumn[];
    /** Latest metric value per member/metric, keyed by `${memberId}:${metricId}` — a plain object (not a Map) to cross the Server->Client boundary safely. */
    metricValues: Record<string, number>;
    selectedPeriodId?: string;
    /** Selection and bulk archive/restore only render when the caller can manage members — mirrors the server-side gate MemberActions already uses. */
    canManageMembers: boolean;
    /** Current active-member count, used for the restore dialog's capacity math. */
    activeCount: number;
};

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "Dragon, Phoenix, Wolf, Bear, Tiger and 3 more" — never lets a huge selection blow up the confirmation dialog. */
function buildNamesPreview(names: string[], limit = 5): string {
    if (names.length <= limit) {
        return names.join(", ");
    }
    const shown = names.slice(0, limit);
    const remaining = names.length - limit;
    return `${shown.join(", ")} and ${remaining} more`;
}

export function MembersTable({
    allianceId,
    filter,
    members,
    periodMetricColumns,
    metricValues,
    selectedPeriodId,
    canManageMembers,
    activeCount,
}: MembersTableProps) {
    const router = useRouter();
    const selectAllId = useId();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [pendingAction, setPendingAction] = useState<"archive" | "restore" | null>(null);
    const [resultSummary, setResultSummary] = useState<string | null>(null);

    // Decision #277 PR2: one intent per view. Active -> Archive only,
    // Archived -> Restore only, All -> browse-only (no bulk selection at all).
    const bulkAction: "archive" | "restore" | null =
        !canManageMembers || filter === "all" ? null : filter === "active" ? "archive" : "restore";

    const selectedCount = selectedIds.size;
    const allSelected = members.length > 0 && selectedCount === members.length;
    const someSelected = selectedCount > 0 && !allSelected;

    function toggleSelectAll(checked: boolean) {
        setResultSummary(null);
        setSelectedIds(checked ? new Set(members.map((m) => m.id)) : new Set());
    }

    function toggleOne(memberId: string, checked: boolean) {
        setResultSummary(null);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(memberId);
            } else {
                next.delete(memberId);
            }
            return next;
        });
    }

    const selectedMembers = members.filter((m) => selectedIds.has(m.id));
    const selectedNames = selectedMembers.map((m) => m.playerName);

    const restoreCapacityError =
        bulkAction === "restore" ? getMemberCapacityError(activeCount, selectedCount, "restore") : null;
    const availableCapacity = getAvailableMemberCapacity(activeCount);

    async function handleConfirm(): Promise<{ error?: string } | void> {
        const formData = new FormData();
        formData.set("allianceId", allianceId);
        for (const id of selectedIds) {
            formData.append("memberId", id);
        }

        if (bulkAction === "archive") {
            const result = await bulkArchiveMembers(formData);
            if (!result.success) {
                return { error: result.error };
            }
            setResultSummary(
                `Archived ${pluralize(result.archivedCount, "member")}.` +
                    (result.skippedCount > 0
                        ? ` ${pluralize(result.skippedCount, "member")} ${result.skippedCount === 1 ? "was" : "were"} already archived and skipped.`
                        : "")
            );
        } else if (bulkAction === "restore") {
            const result = await bulkRestoreMembers(formData);
            if (!result.success) {
                return { error: result.error };
            }
            setResultSummary(
                `Restored ${pluralize(result.restoredCount, "member")}.` +
                    (result.skippedCount > 0
                        ? ` ${pluralize(result.skippedCount, "member")} ${result.skippedCount === 1 ? "was" : "were"} already active and skipped.`
                        : "")
            );
        }

        setSelectedIds(new Set());
        router.refresh();
    }

    const dialogTitle =
        bulkAction === "archive"
            ? `Archive ${pluralize(selectedCount, "member")}?`
            : `Restore ${pluralize(selectedCount, "member")}?`;
    const dialogConfirmLabel =
        bulkAction === "archive" ? `Archive ${pluralize(selectedCount, "member")}` : `Restore ${pluralize(selectedCount, "member")}`;

    const dialogDescription = (
        <>
            {bulkAction === "archive" && (
                <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
                    <li>They will leave the active roster.</li>
                    <li>Metrics, notes, invitations, linked accounts, and history will be preserved.</li>
                    <li>They can be restored later.</li>
                </ul>
            )}
            {bulkAction === "restore" &&
                (restoreCapacityError ? (
                    <p className="text-sm text-warning-light">{restoreCapacityError}</p>
                ) : (
                    <p className="text-sm text-text-secondary">
                        Active roster: {activeCount} → {activeCount + selectedCount};{" "}
                        {pluralize(availableCapacity - selectedCount, "space")} remaining.
                    </p>
                ))}
            {selectedNames.length > 0 && (
                <p className="text-sm text-text-primary mt-2 break-words">{buildNamesPreview(selectedNames)}</p>
            )}
        </>
    );

    return (
        <>
            {resultSummary && (
                <div
                    role="status"
                    className="mb-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-text-primary"
                >
                    {resultSummary}
                </div>
            )}

            {bulkAction && selectedCount > 0 && (
                <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                    <span className="text-sm font-medium text-text-primary">
                        {pluralize(selectedCount, "member")} selected
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                            Clear
                        </Button>
                        <Button
                            variant={bulkAction === "archive" ? "warning" : "primary"}
                            size="sm"
                            onClick={() => setPendingAction(bulkAction)}
                        >
                            {bulkAction === "archive" ? "Archive selected" : "Restore selected"}
                        </Button>
                    </div>
                </div>
            )}

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-surface-secondary border-b border-border">
                            <tr>
                                {bulkAction && (
                                    <th className="w-12 px-4 py-3">
                                        <input
                                            id={selectAllId}
                                            type="checkbox"
                                            checked={allSelected}
                                            ref={(el) => {
                                                if (el) el.indeterminate = someSelected;
                                            }}
                                            onChange={(e) => toggleSelectAll(e.target.checked)}
                                            aria-label={
                                                filter === "active"
                                                    ? "Select all active members"
                                                    : "Select all archived members"
                                            }
                                            className="w-4 h-4 rounded border-border"
                                        />
                                    </th>
                                )}
                                <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                    Player
                                </th>
                                {periodMetricColumns.map((metric) => (
                                    <th
                                        key={metric.metricId}
                                        className="text-right px-4 py-3 text-sm font-medium text-text-secondary whitespace-nowrap"
                                    >
                                        {metric.metricName}
                                    </th>
                                ))}
                                <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                    THP
                                </th>
                                <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">
                                    Squad Power
                                </th>
                                <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">
                                    Role
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map((member) => {
                                const memberHref = `/alliances/${allianceId}/members/${member.id}${selectedPeriodId ? `?periodId=${encodeURIComponent(selectedPeriodId)}` : ""}`;

                                return (
                                    <tr
                                        key={member.id}
                                        className="border-b border-border hover:bg-surface-secondary transition-colors cursor-pointer"
                                    >
                                        {bulkAction && (
                                            <td className="px-4 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(member.id)}
                                                    onChange={(e) => toggleOne(member.id, e.target.checked)}
                                                    aria-label={`Select ${member.playerName}`}
                                                    className="w-4 h-4 rounded border-border"
                                                />
                                            </td>
                                        )}
                                        <td className="p-0">
                                            <Link
                                                href={memberHref}
                                                className="block px-4 py-3 font-medium text-primary-light hover:text-primary"
                                            >
                                                {member.playerName}
                                                {member.archivedAt && (
                                                    <Badge variant="neutral" size="sm" className="ml-2">
                                                        Archived
                                                    </Badge>
                                                )}
                                            </Link>
                                        </td>
                                        {periodMetricColumns.map((metric) => {
                                            const value = metricValues[`${member.id}:${metric.metricId}`];

                                            return (
                                                <td key={metric.metricId} className="p-0 text-right">
                                                    <Link
                                                        href={memberHref}
                                                        className="block px-4 py-3 text-text-primary font-medium whitespace-nowrap"
                                                        aria-label={`${member.playerName} ${metric.metricName}`}
                                                    >
                                                        {value == null ? "—" : formatPower(value)}
                                                    </Link>
                                                </td>
                                            );
                                        })}
                                        <td className="p-0 text-right">
                                            <Link
                                                href={memberHref}
                                                className="block px-4 py-3 text-text-secondary whitespace-nowrap"
                                                aria-label={`${member.playerName} THP`}
                                            >
                                                {member.thp == null ? "—" : formatPower(member.thp)}
                                            </Link>
                                        </td>
                                        <td className="p-0 text-right">
                                            <Link
                                                href={memberHref}
                                                className="block px-4 py-3 text-text-secondary whitespace-nowrap"
                                                aria-label={`${member.playerName} Squad Power`}
                                            >
                                                {member.squadPower == null ? "—" : formatPower(member.squadPower)}
                                            </Link>
                                        </td>
                                        <td className="p-0">
                                            <Link
                                                href={memberHref}
                                                className="block px-4 py-3 text-text-secondary whitespace-nowrap"
                                                aria-label={`${member.playerName} Role`}
                                            >
                                                {member.role || "—"}
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>

            {bulkAction && (
                <ConfirmDialog
                    isOpen={pendingAction !== null}
                    title={dialogTitle}
                    description={dialogDescription}
                    confirmLabel={dialogConfirmLabel}
                    pendingLabel={bulkAction === "archive" ? "Archiving…" : "Restoring…"}
                    confirmVariant={bulkAction === "archive" ? "warning" : "primary"}
                    confirmDisabled={bulkAction === "restore" && restoreCapacityError !== null}
                    onConfirm={handleConfirm}
                    onClose={() => setPendingAction(null)}
                />
            )}
        </>
    );
}
