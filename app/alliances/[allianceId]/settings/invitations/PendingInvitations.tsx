"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/src/components/Button";
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
  onInvitationChanged?: (invitationId: string) => void;
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

  const handleCancel = (invitation: PendingInvitation) => {
    if (!confirm(
      `Revoke the invitation for ${invitation.playerNameSnapshot} (${invitation.email})?\n\nTheir current invitation link and code will stop working. To correct an email address, send a new invitation after revoking this one. This will not remove the member record.`
    )) return;
    const invitationId = invitation.id;

    setError(null);
    setResendResult(null);
    onInvitationChanged?.(invitationId);
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
    onInvitationChanged?.(invitationId);
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

      <p className="text-sm text-text-secondary">
        Manage each invitation below. If the email is incorrect, revoke it and send a new invitation.
      </p>
      <ul role="list" aria-label="Pending invitations" aria-busy={isPending} className="space-y-4">
        {invitations.map((invitation) => {
          const expired = isExpired(invitation.expiresAt);
          return (
            <li key={invitation.id} className="min-w-0 rounded-lg border border-border p-4">
              <h3 className="font-semibold text-text-primary [overflow-wrap:anywhere]">
                {invitation.playerNameSnapshot}
              </h3>
              <p className="mt-1 text-sm text-text-secondary [overflow-wrap:anywhere]">
                {invitation.email}
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-text-muted">Role</dt>
                  <dd className="mt-1 text-text-secondary">{formatRole(invitation.membershipRole)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-text-muted">Invited by</dt>
                  <dd className="mt-1 text-text-secondary [overflow-wrap:anywhere]">{invitation.invitedBy.displayName}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-text-muted">Expires</dt>
                  <dd className={`mt-1 ${expired ? "text-warning-light" : "text-text-secondary"}`}>
                    {expired ? "Expired" : formatDate(invitation.expiresAt)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row">
                <Button type="button" variant="secondary" size="lg" onClick={() => handleResend(invitation.id)} disabled={isPending}>
                  Resend
                </Button>
                <Button type="button" variant="danger" size="lg" onClick={() => handleCancel(invitation)} disabled={isPending}>
                  Revoke invitation
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
