"use client";

import { useState, useTransition } from "react";
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
  const [error, setError] = useState<string | null>(null);

  async function handleArchive() {
    if (
      !confirm(
        "Are you sure you want to archive this member? They will be hidden from the active roster but their data will be preserved."
      )
    ) {
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("allianceId", allianceId);
    formData.set("memberId", memberId);

    startTransition(async () => {
      const result = await archiveMember(formData);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to archive member");
      }
    });
  }

  async function handleRestore() {
    setError(null);
    const formData = new FormData();
    formData.set("allianceId", allianceId);
    formData.set("memberId", memberId);

    startTransition(async () => {
      const result = await restoreMember(formData);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to restore member");
      }
    });
  }

  return (
    <div className="mt-4 space-y-3">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex gap-3">
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
    </div>
  );
}
