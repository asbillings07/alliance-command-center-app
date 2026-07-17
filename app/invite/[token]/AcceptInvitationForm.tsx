"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation } from "./action";

type AcceptInvitationFormProps = {
  invitationId: string;
  allianceId: string;
  allianceName: string;
};

export function AcceptInvitationForm({
  invitationId,
  allianceName,
}: Omit<AcceptInvitationFormProps, "allianceId">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(invitationId);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-md text-sm text-[#EF4444]">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleAccept}
        disabled={isPending}
        className="w-full px-4 py-2 bg-[#3B82F6] text-white rounded-md hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Joining..." : `Join ${allianceName}`}
      </button>
    </div>
  );
}
