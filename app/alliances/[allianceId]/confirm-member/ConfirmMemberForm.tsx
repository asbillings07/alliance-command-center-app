"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmMember } from "./action";

type Member = {
  id: string;
  playerName: string;
};

type ConfirmMemberFormProps = {
  allianceId: string;
  members: Member[];
};

export function ConfirmMemberForm({
  allianceId,
  members,
}: ConfirmMemberFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await confirmMember(allianceId, selectedMemberId);

      if (result.error) {
        setError(result.error);
        return;
      }

      router.push(`/alliances/${allianceId}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-md p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {members.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {members.map((member) => (
            <label
              key={member.id}
              className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                selectedMemberId === member.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-border-hover bg-surface-secondary"
              }`}
            >
              <input
                type="radio"
                name="memberId"
                value={member.id}
                checked={selectedMemberId === member.id}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="accent-primary"
              />
              <span className="font-medium text-text-primary">
                {member.playerName}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-text-muted text-sm text-center py-4">
          No unlinked members found.
        </p>
      )}

      <label
        className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
          selectedMemberId === null
            ? "border-primary bg-primary/10"
            : "border-border hover:border-border-hover bg-surface-secondary"
        }`}
      >
        <input
          type="radio"
          name="memberId"
          value=""
          checked={selectedMemberId === null}
          onChange={() => setSelectedMemberId(null)}
          className="accent-primary"
        />
        <span className="text-text-secondary">None of these / Skip for now</span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
      >
        {isPending ? "Confirming..." : "Continue"}
      </button>
    </form>
  );
}
