"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { archiveMember, restoreMember } from "./member-actions";

interface MemberActionsProps {
    allianceId: string;
    memberId: string;
    isArchived: boolean;
}

export function MemberActions({
    allianceId,
    memberId,
    isArchived,
}: MemberActionsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    async function handleArchive() {
        if (!confirm("Are you sure you want to archive this member? They will be hidden from the active roster but their data will be preserved.")) {
            return;
        }

        const formData = new FormData();
        formData.set("allianceId", allianceId);
        formData.set("memberId", memberId);

        startTransition(async () => {
            const result = await archiveMember(formData);
            if (result.success) {
                router.refresh();
            } else {
                alert(result.error);
            }
        });
    }

    async function handleRestore() {
        const formData = new FormData();
        formData.set("allianceId", allianceId);
        formData.set("memberId", memberId);

        startTransition(async () => {
            const result = await restoreMember(formData);
            if (result.success) {
                router.refresh();
            } else {
                alert(result.error);
            }
        });
    }

    return (
        <div className="flex gap-3 mt-4">
            {!isArchived && (
                <Link
                    href={`/alliances/${allianceId}/members/${memberId}/edit`}
                    className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                    Edit
                </Link>
            )}
            {isArchived ? (
                <button
                    onClick={handleRestore}
                    disabled={isPending}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                    {isPending ? "Restoring..." : "Restore"}
                </button>
            ) : (
                <button
                    onClick={handleArchive}
                    disabled={isPending}
                    className="px-4 py-2 text-sm bg-amber-100 text-amber-700 rounded-md hover:bg-amber-200 disabled:opacity-50"
                >
                    {isPending ? "Archiving..." : "Archive"}
                </button>
            )}
        </div>
    );
}
