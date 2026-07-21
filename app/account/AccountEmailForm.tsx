"use client";

import { useActionState, useState } from "react";
import { beginEmailChange } from "./actions";
import type { UpdateProfileState } from "./actions";
import { Button, Input, Label } from "@/app/src/components/client";

const initialState: UpdateProfileState = { status: "idle", message: null };

type AccountEmailFormProps = {
  email: string;
  /**
   * Whether the account can change its email. Gated on having a password (#147):
   * the current password is the re-auth proof, so a password-less (Google-only)
   * account must set one first. Not about which providers are linked.
   */
  canChange: boolean;
};

export function AccountEmailForm({ email, canChange }: AccountEmailFormProps) {
  const [state, formAction, isPending] = useActionState(
    beginEmailChange,
    initialState
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <Label>Sign-in Email</Label>
        <div className="px-4 py-2 bg-surface-secondary border border-border rounded-lg text-text-muted">
          {email}
        </div>
        {!canChange && (
          <p className="mt-2 text-sm text-text-muted">
            Set a password in Sign-in &amp; Security below to enable email
            changes. It confirms the change is really you.
          </p>
        )}
      </div>

      {canChange && !open && state.status !== "success" && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Change email
        </Button>
      )}

      {canChange && state.status === "success" && state.message && (
        <div className="p-3 bg-success/10 border border-success text-success rounded-md text-sm">
          {state.message}
        </div>
      )}

      {canChange && open && state.status !== "success" && (
        <form className="space-y-5" action={formAction}>
          {state.status === "error" && state.message && (
            <div className="p-3 bg-danger/10 border border-danger text-danger rounded-md text-sm">
              {state.message}
            </div>
          )}

          <div>
            <Label htmlFor="newEmail" required>
              New Email
            </Label>
            <Input
              id="newEmail"
              name="newEmail"
              type="email"
              required
              disabled={isPending}
              autoComplete="email"
            />
            <p className="mt-2 text-sm text-text-muted">
              We&apos;ll send a verification link here. Your sign-in email
              won&apos;t change until you confirm it.
            </p>
          </div>

          <div>
            <Label htmlFor="currentPassword" required>
              Current Password
            </Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              disabled={isPending}
              autoComplete="current-password"
            />
            <p className="mt-2 text-sm text-text-muted">
              For your security, confirm your password to request this change.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" loading={isPending}>
              {isPending ? "Sending..." : "Send verification link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
