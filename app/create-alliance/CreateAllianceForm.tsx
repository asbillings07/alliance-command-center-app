"use client";

import { useActionState } from "react";
import { createAllianceAction, type CreateAllianceState } from "./action";

const initialState: CreateAllianceState = { error: null };

type Props = {
  betaInvitationId: string;
};

export function CreateAllianceForm({ betaInvitationId }: Props) {
  const [state, formAction, isPending] = useActionState(
    createAllianceAction,
    initialState
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="betaInvitationId" value={betaInvitationId} />

      {state.error && (
        <div className="p-3 bg-danger/10 border border-danger/20 rounded-md">
          <p className="text-sm text-danger-light">{state.error}</p>
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-text-secondary mb-2"
        >
          Alliance Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          disabled={isPending}
          placeholder="e.g., DAY1"
          className="w-full px-4 py-3 bg-surface-secondary border border-border rounded-md text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          autoComplete="off"
          autoFocus
        />
        <p className="mt-1 text-xs text-text-muted">
          This is how your alliance will appear throughout the app
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-3 bg-primary-hover text-white font-medium rounded-md hover:bg-primary-active disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Creating Alliance..." : "Create Alliance"}
      </button>
    </form>
  );
}
