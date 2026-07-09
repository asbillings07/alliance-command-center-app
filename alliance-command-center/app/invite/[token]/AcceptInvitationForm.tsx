"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation } from "./action";

type AcceptInvitationFormProps = {
  invitationId: string;
  allianceId: string;
  allianceName: string;
};

export function AcceptInvitationForm({
  invitationId,
  allianceId,
  allianceName,
}: AcceptInvitationFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleAccept = () => {
    startTransition(async () => {
      const result = await acceptInvitation(invitationId);

      if (result.error) {
        alert(result.error);
        return;
      }

      if (result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleAccept}
      disabled={isPending}
      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isPending ? "Joining..." : `Join ${allianceName}`}
    </button>
  );
}
