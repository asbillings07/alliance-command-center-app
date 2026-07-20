"use client";

import { useActionState } from "react";
import { updatePassword, type UpdateProfileState } from "./actions";
import { Button, PasswordField } from "@/app/src/components/client";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
} from "@/app/src/lib/password";

const initialState: UpdateProfileState = { status: "idle", message: null };

type AccountSecurityFormProps = {
  hasPassword: boolean;
  hasGoogle: boolean;
};

function MethodRow({ label, active, activeText, inactiveText }: {
  label: string;
  active: boolean;
  activeText: string;
  inactiveText: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <span
        className={`text-sm ${active ? "text-success" : "text-text-muted"}`}
      >
        {active ? activeText : inactiveText}
      </span>
    </div>
  );
}

/**
 * Advertise the password policy up front so users aren't left guessing. The
 * rules are driven by the shared PASSWORD_* constants (the same source the
 * validator uses), so this stays in sync if the policy changes.
 */
function PasswordRequirements() {
  return (
    <div className="rounded-md bg-surface-secondary/50 px-3 py-2 text-xs text-text-muted">
      <p className="font-medium text-text-secondary">Password requirements</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>At least {PASSWORD_MIN_LENGTH} characters</li>
        <li>Up to {PASSWORD_MAX_BYTES} bytes (about {PASSWORD_MAX_BYTES} characters)</li>
      </ul>
    </div>
  );
}

export function AccountSecurityForm({
  hasPassword,
  hasGoogle,
}: AccountSecurityFormProps) {
  const [state, formAction, isPending] = useActionState(
    updatePassword,
    initialState
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          Sign-in methods
        </h3>
        <p className="mt-1 text-sm text-text-muted">
          How you can sign in to your account.
        </p>
        <div className="mt-3 divide-y divide-border border-t border-b border-border">
          <MethodRow
            label="Password"
            active={hasPassword}
            activeText="Set"
            inactiveText="Not set"
          />
          <MethodRow
            label="Google"
            active={hasGoogle}
            activeText="Connected"
            inactiveText="Not connected"
          />
        </div>
      </div>

      <form className="space-y-4" action={formAction}>
        <h3 className="text-sm font-semibold text-text-primary">
          {hasPassword ? "Change password" : "Set a password"}
        </h3>
        {!hasPassword && (
          <p className="text-sm text-text-muted">
            Add a password so you can also sign in with your email and password,
            in addition to Google.
          </p>
        )}

        {state.status === "success" && state.message && (
          <div className="p-3 bg-success/10 border border-success text-success rounded-md text-sm">
            {state.message}
          </div>
        )}
        {state.status === "error" && state.message && (
          <div className="p-3 bg-danger/10 border border-danger text-danger rounded-md text-sm">
            {state.message}
          </div>
        )}

        {hasPassword && (
          <PasswordField
            id="currentPassword"
            name="currentPassword"
            label="Current password"
            required
            disabled={isPending}
            autoComplete="current-password"
          />
        )}

        <PasswordField
          id="newPassword"
          name="newPassword"
          label="New password"
          required
          disabled={isPending}
          autoComplete="new-password"
        />

        <PasswordRequirements />

        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm new password"
          required
          disabled={isPending}
          autoComplete="new-password"
        />

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={isPending}>
            {isPending
              ? "Saving..."
              : hasPassword
                ? "Change Password"
                : "Set Password"}
          </Button>
        </div>
      </form>
    </div>
  );
}
