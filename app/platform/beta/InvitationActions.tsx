"use client";

import { useEffect, useState, useTransition } from "react";
import {
  resendInvitationEmailAction,
  revokeInvitationAction,
} from "./actions";
import type { EmailStatus } from "@/app/src/lib/email";

type CopyState = "idle" | "copied";

type ResendState = "idle" | EmailStatus;

function resendLabel(state: ResendState, isPending: boolean): string {
  if (isPending) return "...";
  switch (state) {
    case "sent":
      return "Sent!";
    case "skipped":
      return "Logged";
    case "failed":
      return "Failed";
    default:
      return "Email";
  }
}

function useCopy() {
  const [state, setState] = useState<CopyState>("idle");

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    }
  };

  return { state, copy };
}

type InvitationActionsProps = {
  invitationId: string;
  code: string;
  inviteUrl: string;
};

export function InvitationActions({
  invitationId,
  code,
  inviteUrl,
}: InvitationActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [isResending, startResend] = useTransition();
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { state: codeState, copy: copyCode } = useCopy();
  const { state: urlState, copy: copyUrl } = useCopy();

  // Auto-reset the transient resend status. Keyed on resendState so the timer
  // is cleared if the component unmounts (e.g. after a revalidate) before it
  // fires, avoiding state updates on an unmounted component.
  useEffect(() => {
    if (resendState === "idle") return;
    const timer = setTimeout(() => setResendState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [resendState]);

  const handleRevoke = () => {
    if (!confirm("Are you sure you want to revoke this invitation?")) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await revokeInvitationAction(invitationId);
      if (!result.success) {
        setError(result.error);
      }
    });
  };

  const handleResend = () => {
    setError(null);
    startResend(async () => {
      const result = await resendInvitationEmailAction(invitationId);
      if (result.success) {
        setResendState(result.emailStatus);
      } else {
        setResendState("failed");
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => copyUrl(inviteUrl)}
        className="text-xs text-primary hover:text-primary-hover"
        title="Copy invite URL"
      >
        {urlState === "copied" ? "Copied!" : "URL"}
      </button>
      <span className="text-text-disabled">·</span>
      <button
        type="button"
        onClick={() => copyCode(code)}
        className="text-xs text-primary hover:text-primary-hover"
        title="Copy invite code"
      >
        {codeState === "copied" ? "Copied!" : "Code"}
      </button>
      <span className="text-text-disabled">·</span>
      <button
        type="button"
        onClick={handleResend}
        disabled={isResending}
        className="text-xs text-primary hover:text-primary-hover disabled:opacity-50"
        title="Resend invitation email"
      >
        {resendLabel(resendState, isResending)}
      </button>
      <span className="text-text-disabled">·</span>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={isPending}
        className="text-xs text-danger hover:text-danger/80 disabled:opacity-50"
        title="Revoke invitation"
      >
        {isPending ? "..." : "Revoke"}
      </button>
      {error && (
        <span className="text-xs text-danger ml-2" title={error}>
          Failed
        </span>
      )}
    </div>
  );
}

/**
 * Mobile-friendly action buttons for invitation cards.
 */
export function InvitationCardActions({
  invitationId,
  code,
  inviteUrl,
}: InvitationActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [isResending, startResend] = useTransition();
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { state: codeState, copy: copyCode } = useCopy();
  const { state: urlState, copy: copyUrl } = useCopy();

  // Auto-reset the transient resend status. Keyed on resendState so the timer
  // is cleared if the component unmounts (e.g. after a revalidate) before it
  // fires, avoiding state updates on an unmounted component.
  useEffect(() => {
    if (resendState === "idle") return;
    const timer = setTimeout(() => setResendState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [resendState]);

  const handleRevoke = () => {
    if (!confirm("Are you sure you want to revoke this invitation?")) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await revokeInvitationAction(invitationId);
      if (!result.success) {
        setError(result.error);
      }
    });
  };

  const handleResend = () => {
    setError(null);
    startResend(async () => {
      const result = await resendInvitationEmailAction(invitationId);
      if (result.success) {
        setResendState(result.emailStatus);
      } else {
        setResendState("failed");
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
      <button
        type="button"
        onClick={() => copyUrl(inviteUrl)}
        className="px-3 py-1 text-sm bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-lg transition-colors"
      >
        {urlState === "copied" ? "Copied!" : "Copy URL"}
      </button>
      <button
        type="button"
        onClick={() => copyCode(code)}
        className="px-3 py-1 text-sm bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-lg transition-colors"
      >
        {codeState === "copied" ? "Copied!" : "Copy Code"}
      </button>
      <button
        type="button"
        onClick={handleResend}
        disabled={isResending}
        className="px-3 py-1 text-sm bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-lg transition-colors disabled:opacity-50"
      >
        {isResending
          ? "Resending..."
          : resendState === "idle"
            ? "Resend Email"
            : resendLabel(resendState, false)}
      </button>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={isPending}
        className="px-3 py-1 text-sm bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 rounded-lg transition-colors disabled:opacity-50"
      >
        {isPending ? "Revoking..." : "Revoke"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
