"use client";

import { useActionState } from "react";
import { updatePassword, type UpdateProfileState } from "./actions";
import { Button, PasswordField } from "@/app/src/components/client";
import { PASSWORD_MIN_LENGTH } from "@/app/src/lib/password";

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
 * Advertise only the requirements a user needs to know up front. Today that's
 * the minimum length, driven by the shared PASSWORD_MIN_LENGTH constant (the
 * same source the validator uses). The bcrypt 72-byte cap is intentionally not
 * shown here: virtually no one hits it, so surfacing it would be noise — the
 * validator reports it as an error only in the rare case it's exceeded. If the
 * policy grows (numbers, symbols, etc.), add those rules here.
 */
function PasswordRequirements() {
  return (
    <p className="text-xs text-text-muted">
      Use at least {PASSWORD_MIN_LENGTH} characters.
    </p>
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
