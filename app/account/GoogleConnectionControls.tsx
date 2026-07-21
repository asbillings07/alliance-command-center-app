"use client";

import { useActionState, useState } from "react";
import { Button, PasswordField } from "@/app/src/components/client";
import {
  connectGoogle,
  disconnectGoogle,
  type UpdateProfileState,
} from "./actions";

const initialState: UpdateProfileState = { status: "idle", message: null };

type GoogleConnectionControlsProps = {
  hasPassword: boolean;
  hasGoogle: boolean;
  /** The connected Google account's email, for display only. */
  googleEmail: string | null;
};

/**
 * Interactive Google connect / disconnect control for the Sign-in methods
 * panel (#131).
 *
 * - Not connected: a single "Connect Google" button that starts the OAuth
 *   challenge (the challenge itself is the proof; no password prompt).
 * - Connected: a "Disconnect" control that expands an inline current-password
 *   re-auth before submitting. Disabled for Google-only accounts (no password),
 *   with a hint to set one first, so a user can never lock themselves out.
 *
 * Server-side authorization is authoritative (the action re-checks the password
 * and the lockout guard); disabling here is only UX.
 */
export function GoogleConnectionControls({
  hasPassword,
  hasGoogle,
  googleEmail,
}: GoogleConnectionControlsProps) {
  const [state, formAction, isPending] = useActionState(
    disconnectGoogle,
    initialState
  );
  const [confirming, setConfirming] = useState(false);

  // "Connected as x@gmail.com" when we know the email; otherwise a plain
  // "Connected" (e.g. a legacy link before the email metadata was recorded).
  const status = hasGoogle
    ? googleEmail
      ? `Connected as ${googleEmail}`
      : "Connected"
    : "Not connected";

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text-secondary">Google</span>
        <div className="flex items-center gap-3">
          <span
            className={`text-sm ${hasGoogle ? "text-success" : "text-text-muted"}`}
          >
            {status}
          </span>
          {!hasGoogle ? (
            <form action={connectGoogle}>
              <Button type="submit" variant="secondary" size="sm">
                Connect
              </Button>
            </form>
          ) : hasPassword ? (
            !confirming && (
              <Button
                type="button"
                variant="danger-link"
                onClick={() => setConfirming(true)}
              >
                Disconnect
              </Button>
            )
          ) : (
            <Button type="button" variant="danger-link" disabled>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {hasGoogle && !hasPassword && (
        <p className="mt-2 text-xs text-text-muted">
          Set a password first so you don&apos;t lose access to your account.
        </p>
      )}

      {hasGoogle && hasPassword && confirming && (
        <form action={formAction} className="mt-3 space-y-3">
          <p className="text-sm text-text-muted">
            Enter your password to disconnect Google. You&apos;ll still be able
            to sign in with your email and password.
          </p>
          <PasswordField
            id="disconnectPassword"
            name="currentPassword"
            label="Current password"
            required
            disabled={isPending}
            autoComplete="current-password"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="danger"
              size="sm"
              loading={isPending}
              disabled={isPending}
            >
              {isPending ? "Disconnecting..." : "Disconnect Google"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {state.status === "error" && state.message && (
        <p className="mt-2 text-xs text-danger">{state.message}</p>
      )}
      {state.status === "success" && state.message && (
        <p className="mt-2 text-xs text-success">{state.message}</p>
      )}
    </div>
  );
}
