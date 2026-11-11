"use client";

import { useActionState } from "react";
import { acceptBetaInvitation, type AcceptState } from "./action";

const initialState: AcceptState = { error: null };

type Props = {
  invitationId: string;
};

export function AcceptBetaInvitationForm({ invitationId }: Props) {
  const [state, formAction, isPending] = useActionState(
    acceptBetaInvitation,
    initialState
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="invitationId" value={invitationId} />

      {state.error && (
        <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-md">
          <p className="text-sm text-danger-light">{state.error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-2 bg-primary-hover text-white font-medium rounded-md hover:bg-primary-active disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Accepting..." : "Accept Invitation"}
      </button>
    </form>
  );
}
