"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveMember, restoreMember } from "./member-actions";
import { Button } from "@/app/src/components";

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
        <div className="p-3 bg-danger/10 border border-danger rounded-md text-sm text-danger">
          {error}
        </div>
      )}
      <div className="flex gap-3">
        {!isArchived && (
          <Button
            variant="secondary"
            size="sm"
            href={`/alliances/${allianceId}/members/${memberId}/edit`}
          >
            Edit
          </Button>
        )}
        {isArchived ? (
          <Button
            variant="primary"
            size="sm"
            onClick={handleRestore}
            loading={isPending}
          >
            {isPending ? "Restoring..." : "Restore"}
          </Button>
        ) : (
          <Button
            variant="warning"
            size="sm"
            onClick={handleArchive}
            loading={isPending}
          >
            {isPending ? "Archiving..." : "Archive"}
          </Button>
        )}
      </div>
    </div>
  );
}
