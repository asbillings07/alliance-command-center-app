"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelInvitationAction, resendInvitationAction } from "./action";
import { InvitationEmailNotice } from "./InvitationEmailNotice";
import type { EmailStatus } from "@/app/src/lib/email/types";

export type PendingInvitation = {
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
  onInvitationChanged?: () => void;
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
  onInvitationChanged,
}: PendingInvitationsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{
    inviteUrl: string;
    inviteCode: string;
    emailStatus: EmailStatus | "unknown";
  } | null>(null);

  const handleCancel = (invitationId: string) => {
    if (!confirm("Are you sure you want to cancel this invitation?")) return;

    setError(null);
    setResendResult(null);
    onInvitationChanged?.();
    startTransition(async () => {
      try {
        const result = await cancelInvitationAction(allianceId, invitationId);
        if (result.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("Could not confirm cancellation. Refresh Pending Invitations to check its status before trying again.");
      }
    });
  };

  const handleResend = (invitationId: string) => {
    setError(null);
    setResendResult(null);
    onInvitationChanged?.();
    startTransition(async () => {
      try {
        const result = await resendInvitationAction(allianceId, invitationId);
        if (result.error) {
          setError(result.error);
        } else if (result.data) {
          setResendResult({
            inviteUrl: result.data.inviteUrl,
            inviteCode: result.data.inviteCode,
            emailStatus: result.data.emailStatus,
          });
          router.refresh();
        }
      } catch {
        setError("Could not confirm renewal or email delivery. The previous link and code may have been replaced. Refresh Pending Invitations and check delivery before trying again.");
      }
    });
  };

  if (invitations.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 mx-auto mb-3 bg-surface-secondary rounded-full flex items-center justify-center">
          <svg
            className="w-6 h-6 text-text-muted"
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
        <p className="text-text-secondary font-medium">No pending invitations</p>
        <p className="text-sm text-text-muted mt-1">
          Use the form above to invite collaborators to your leadership team.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="p-3 bg-danger/20 border border-danger/30 rounded-md text-sm text-danger-light">
          {error}
        </div>
      )}

      {resendResult && (
        <div className="bg-surface-secondary border border-border rounded-md p-4 mb-4">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-success-light mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Invitation renewed
                </p>
                <p className="mt-1 text-xs text-text-secondary">The previous link and code have been replaced.</p>
                <InvitationEmailNotice status={resendResult.emailStatus} />
                <div className="mt-1.5 space-y-1">
                  <p className="text-xs text-text-secondary break-all">
                    <span className="text-text-muted">Link:</span> {resendResult.inviteUrl}
                  </p>
                  <p className="text-xs text-text-secondary font-mono">
                    <span className="font-sans text-text-muted">Code:</span> {resendResult.inviteCode}
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setResendResult(null)}
              aria-label="Dismiss invitation result"
              className="text-text-muted hover:text-text-muted"
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
            <tr className="border-b border-border">
              <th className="pb-3 pr-6 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                Player
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                Email
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                Role
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                Invited By
              </th>
              <th className="pb-3 pr-6 text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                Expires
              </th>
              <th className="pb-3 pl-6 text-right text-xs font-medium text-text-muted uppercase tracking-wide">
                
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-secondary">
            {invitations.map((invitation) => {
              const expired = isExpired(invitation.expiresAt);
              return (
                <tr key={invitation.id} className={expired ? "bg-surface-secondary/50" : ""}>
                  <td className="py-3 pr-6 text-sm font-medium text-text-primary">
                    {invitation.playerNameSnapshot}
                  </td>
                  <td className="py-3 pr-6 text-sm text-text-secondary">
                    {invitation.email}
                  </td>
                  <td className="py-3 pr-6 text-sm text-text-secondary">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-secondary text-text-secondary">
                      {formatRole(invitation.membershipRole)}
                    </span>
                  </td>
                  <td className="py-3 pr-6 text-sm text-text-muted">
                    {invitation.invitedBy.displayName}
                  </td>
                  <td className="py-3 pr-6 text-sm">
                    {expired ? (
                      <span className="text-warning-light text-xs font-medium">Expired</span>
                    ) : (
                      <span className="text-text-muted text-xs">
                        {formatDate(invitation.expiresAt)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pl-6 text-sm text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => handleResend(invitation.id)}
                      disabled={isPending}
                      className="text-text-muted hover:text-text-primary disabled:opacity-50 text-xs"
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancel(invitation.id)}
                      disabled={isPending}
                      className="text-text-muted hover:text-danger-light disabled:opacity-50 text-xs"
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
