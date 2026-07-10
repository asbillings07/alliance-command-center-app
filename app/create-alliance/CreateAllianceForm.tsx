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
        <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-md">
          <p className="text-sm text-[#EF4444]">{state.error}</p>
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-[#D1D5DB] mb-2"
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
          className="w-full px-4 py-3 bg-[#1F2937] border border-[#374151] rounded-md text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
          autoComplete="off"
          autoFocus
        />
        <p className="mt-1 text-xs text-[#6B7280]">
          This is how your alliance will appear throughout the app
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-3 bg-[#3B82F6] text-white font-medium rounded-md hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Creating Alliance..." : "Create Alliance"}
      </button>
    </form>
  );
}
