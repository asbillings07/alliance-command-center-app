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
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
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
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="memberId"
                value={member.id}
                checked={selectedMemberId === member.id}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium text-gray-900">
                {member.playerName}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm text-center py-4">
          No unlinked roster members found.
        </p>
      )}

      <label
        className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
          selectedMemberId === null
            ? "border-blue-500 bg-blue-50"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <input
          type="radio"
          name="memberId"
          value=""
          checked={selectedMemberId === null}
          onChange={() => setSelectedMemberId(null)}
          className="text-blue-600 focus:ring-blue-500"
        />
        <span className="text-gray-600">None of these / Skip for now</span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Confirming..." : "Continue"}
      </button>
    </form>
  );
}
