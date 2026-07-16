"use client";

import { useState, useTransition } from "react";
import { PlayerNameCombobox } from "./PlayerNameCombobox";
import { inviteCollaborator, searchMembersAction } from "./action";

type Member = {
  id: string;
  playerName: string;
};

type Selection =
  | { type: "existing"; member: Member }
  | { type: "new"; playerName: string };

type InviteCollaboratorFormProps = {
  allianceId: string;
};

export function InviteCollaboratorForm({
  allianceId,
}: InviteCollaboratorFormProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [email, setEmail] = useState("");
  const [membershipRole, setMembershipRole] = useState<
    "ADMIN" | "LEADER" | "VIEWER"
  >("LEADER");
  const [thp, setThp] = useState("");
  const [squadPower, setSquadPower] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inviteUrl: string;
    inviteCode: string;
    memberCreated: boolean;
  } | null>(null);

  const isNewMember = selection?.type === "new";

  const handleSearchMembers = async (query: string): Promise<Member[]> => {
    const members = await searchMembersAction(allianceId, query);
    return members;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selection || !email.trim()) return;

    setError(null);
    setResult(null);

    startTransition(async () => {
      try {
        // Parse numeric fields, guarding against NaN
        const parseOptionalInt = (value: string): number | undefined => {
          if (!value) return undefined;
          const parsed = parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : undefined;
        };

        const response = await inviteCollaborator({
          allianceId,
          existingMemberId:
            selection.type === "existing" ? selection.member.id : undefined,
          playerName:
            selection.type === "existing"
              ? selection.member.playerName
              : selection.playerName,
          email: email.trim(),
          membershipRole,
          thp: parseOptionalInt(thp),
          squadPower: parseOptionalInt(squadPower),
        });

        if (response.error) {
          setError(response.error);
        } else if (response.data) {
          setResult({
            inviteUrl: response.data.inviteUrl,
            inviteCode: response.data.inviteCode,
            memberCreated: response.data.memberCreated,
          });
          setSelection(null);
          setEmail("");
          setThp("");
          setSquadPower("");
        }
      } catch {
        setError("An unexpected error occurred");
      }
    });
  };

  const handleCopyUrl = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl);
  };

  const handleCopyCode = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteCode);
  };

  if (result) {
    return (
      <div className="border border-[#374151] rounded-lg p-6 bg-[#111827]">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-[#22C55E]/20 rounded-full flex items-center justify-center flex-shrink-0">
            <svg
              className="w-4 h-4 text-[#22C55E]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-[#F9FAFB]">
              Invitation sent
            </h3>
            <p className="text-sm text-[#9CA3AF] mt-0.5">
              {result.memberCreated
                ? "A new roster entry was created. Share the link or code below."
                : "Share the link or code below with your collaborator."}
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#9CA3AF] uppercase tracking-wide mb-1.5">
                  Invitation Link
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={result.inviteUrl}
                    className="flex-1 px-3 py-2 bg-[#1F2937] border border-[#374151] rounded-md text-sm text-[#D1D5DB] min-w-0"
                  />
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="px-3 py-2 bg-[#3B82F6] text-white rounded-md text-sm hover:bg-[#2563EB] flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9CA3AF] uppercase tracking-wide mb-1.5">
                  Invitation Code
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={result.inviteCode}
                    className="flex-1 px-3 py-2 bg-[#1F2937] border border-[#374151] rounded-md text-sm font-mono text-[#D1D5DB] tracking-wider min-w-0"
                  />
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="px-3 py-2 bg-[#3B82F6] text-white rounded-md text-sm hover:bg-[#2563EB] flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#374151]">
              <button
                type="button"
                onClick={() => setResult(null)}
                className="text-sm text-[#3B82F6] hover:text-[#60A5FA]"
              >
                Invite another collaborator →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-md p-3 text-sm text-[#EF4444]">
          {error}
        </div>
      )}

      <PlayerNameCombobox
        onSelect={setSelection}
        searchMembers={handleSearchMembers}
      />

      {selection && (
        <>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[#D1D5DB] mb-1.5"
            >
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="collaborator@example.com"
              className="w-full px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937] text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="role"
              className="block text-sm font-medium text-[#D1D5DB] mb-1.5"
            >
              Role
            </label>
            <select
              id="role"
              value={membershipRole}
              onChange={(e) =>
                setMembershipRole(e.target.value as "ADMIN" | "LEADER" | "VIEWER")
              }
              className="w-full px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent text-sm"
            >
              <option value="ADMIN">Admin — Full access except ownership</option>
              <option value="LEADER">Leader — Can view and record metrics</option>
              <option value="VIEWER">Viewer — Read-only access</option>
            </select>
          </div>

          {isNewMember && (
            <>
              <div className="border-t border-[#374151] pt-4 mt-4">
                <p className="text-xs text-[#9CA3AF] uppercase tracking-wide font-medium mb-3">
                  Optional roster details
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="thp"
                      className="block text-sm font-medium text-[#D1D5DB] mb-1.5"
                    >
                      THP
                    </label>
                    <input
                      type="number"
                      id="thp"
                      value={thp}
                      onChange={(e) => setThp(e.target.value)}
                      placeholder="e.g. 500000000"
                      className="w-full px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937] text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent text-sm"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="squadPower"
                      className="block text-sm font-medium text-[#D1D5DB] mb-1.5"
                    >
                      Squad Power
                    </label>
                    <input
                      type="number"
                      id="squadPower"
                      value={squadPower}
                      onChange={(e) => setSquadPower(e.target.value)}
                      placeholder="e.g. 100000000"
                      className="w-full px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937] text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent text-sm"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isPending || !email.trim()}
              className="w-full px-4 py-2.5 bg-[#3B82F6] text-white rounded-md hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {isPending ? "Sending..." : "Send Invitation"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
