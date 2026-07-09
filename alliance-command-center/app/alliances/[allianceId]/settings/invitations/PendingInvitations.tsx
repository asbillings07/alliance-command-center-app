"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelInvitationAction, resendInvitationAction } from "./action";

type PendingInvitation = {
  id: string;
  playerNameSnapshot: string;
  email: string;
  membershipRole: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: {
    displayName: string;
  };
};

type PendingInvitationsProps = {
  invitations: PendingInvitation[];
  allianceId: string;
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRole(role: string): string {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "LEADER":
      return "Leader";
    case "VIEWER":
      return "Viewer";
    default:
      return role;
  }
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

export function PendingInvitations({
  invitations,
  allianceId,
}: PendingInvitationsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resendResult, setResendResult] = useState<{
    inviteUrl: string;
    inviteCode: string;
  } | null>(null);

  const handleCancel = (invitationId: string) => {
    if (!confirm("Are you sure you want to cancel this invitation?")) return;

    startTransition(async () => {
      const result = await cancelInvitationAction(allianceId, invitationId);
      if (result.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
    });
  };

  const handleResend = (invitationId: string) => {
    startTransition(async () => {
      const result = await resendInvitationAction(allianceId, invitationId);
      if (result.error) {
        alert(result.error);
      } else if (result.data) {
        setResendResult({
          inviteUrl: result.data.inviteUrl,
          inviteCode: result.data.inviteCode,
        });
        router.refresh();
      }
    });
  };

  if (invitations.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 mx-auto mb-3 bg-[#1F2937] rounded-full flex items-center justify-center">
          <svg
            className="w-6 h-6 text-[#6B7280]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <p className="text-[#D1D5DB] font-medium">No pending invitations</p>
        <p className="text-sm text-[#9CA3AF] mt-1">
          Use the form above to invite collaborators to your leadership team.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {resendResult && (
        <div className="bg-[#1F2937] border border-[#374151] rounded-md p-4 mb-4">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-[#22C55E] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-sm font-medium text-[#F9FAFB]">
                  Invitation resent
                </p>
                <div className="mt-1.5 space-y-1">
                  <p className="text-xs text-[#D1D5DB] break-all">
                    <span className="text-[#9CA3AF]">Link:</span> {resendResult.inviteUrl}
                  </p>
                  <p className="text-xs text-[#D1D5DB] font-mono">
                    <span className="font-sans text-[#9CA3AF]">Code:</span> {resendResult.inviteCode}
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setResendResult(null)}
              className="text-[#6B7280] hover:text-[#9CA3AF]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-6 px-6">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-[#374151]">
              <th className="pb-3 pr-6 text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Player
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Email
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Role
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Invited By
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Expires
              </th>
              <th className="pb-3 pl-6 text-right text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1F2937]">
            {invitations.map((invitation) => {
              const expired = isExpired(invitation.expiresAt);
              return (
                <tr key={invitation.id} className={expired ? "opacity-60" : ""}>
                  <td className="py-3 pr-6 text-sm font-medium text-[#F9FAFB]">
                    {invitation.playerNameSnapshot}
                  </td>
                  <td className="py-3 pr-6 text-sm text-[#D1D5DB]">
                    {invitation.email}
                  </td>
                  <td className="py-3 pr-6 text-sm text-[#D1D5DB]">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#1F2937] text-[#D1D5DB]">
                      {formatRole(invitation.membershipRole)}
                    </span>
                  </td>
                  <td className="py-3 pr-6 text-sm text-[#9CA3AF]">
                    {invitation.invitedBy.displayName}
                  </td>
                  <td className="py-3 pr-6 text-sm">
                    {expired ? (
                      <span className="text-[#F59E0B] text-xs font-medium">Expired</span>
                    ) : (
                      <span className="text-[#9CA3AF] text-xs">
                        {formatDate(invitation.expiresAt)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pl-6 text-sm text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => handleResend(invitation.id)}
                      disabled={isPending}
                      className="text-[#9CA3AF] hover:text-[#F9FAFB] disabled:opacity-50 text-xs"
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancel(invitation.id)}
                      disabled={isPending}
                      className="text-[#9CA3AF] hover:text-[#EF4444] disabled:opacity-50 text-xs"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
