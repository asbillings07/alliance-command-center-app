"use client";

import { useState, useTransition } from "react";
import { revokeInvitationAction } from "./actions";

type CopyState = "idle" | "copied";

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
  const [error, setError] = useState<string | null>(null);
  const { state: codeState, copy: copyCode } = useCopy();
  const { state: urlState, copy: copyUrl } = useCopy();

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
  const [error, setError] = useState<string | null>(null);
  const { state: codeState, copy: copyCode } = useCopy();
  const { state: urlState, copy: copyUrl } = useCopy();

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
