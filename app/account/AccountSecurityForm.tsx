"use client";

import { useActionState, useState } from "react";
import { updatePassword, type UpdateProfileState } from "./actions";
import {
  Button,
  PasswordField,
  PasswordRequirements,
} from "@/app/src/components/client";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
} from "@/app/src/lib/password";
import { GoogleConnectionControls } from "./GoogleConnectionControls";

// Single shared encoder: passwordByteLength runs on every keystroke, so reuse
// one instance rather than allocating a TextEncoder per call.
const passwordEncoder = new TextEncoder();
const passwordByteLength = (value: string) =>
  passwordEncoder.encode(value).length;

const initialState: UpdateProfileState = { status: "idle", message: null };

type AccountSecurityFormProps = {
  hasPassword: boolean;
  hasGoogle: boolean;
  /** The connected Google account's email, for display only. */
  googleEmail: string | null;
  /** Whether Google OAuth is configured for this deployment. */
  isGoogleEnabled: boolean;
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

export function AccountSecurityForm({
  hasPassword,
  hasGoogle,
  googleEmail,
  isGoogleEnabled,
}: AccountSecurityFormProps) {
  const [state, formAction, isPending] = useActionState(
    updatePassword,
    initialState
  );

  // Mirror the password fields so the requirements checklist can react as the
  // user types. The inputs stay uncontrolled (submitted via FormData by name);
  // this state drives display only.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Only treat the new password as a reuse of the current one when we can
  // actually see both. currentPassword may be empty if the browser autofilled
  // it without firing onChange — in that case we simply don't flag reuse (and
  // never block submit solely on the current-password field). The server is the
  // authority and rejects an unchanged password regardless.
  const reusesCurrent =
    hasPassword &&
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    newPassword === currentPassword;

  // Gate submit on the new-password rules we can verify here so a user can't
  // submit an obviously-invalid new password. The current-password field's
  // presence is left to native `required` + the server (autofill can fill it
  // without firing onChange), but if we can positively see the new password
  // merely repeats the current one, block that too.
  const canSubmit =
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    passwordByteLength(newPassword) <= PASSWORD_MAX_BYTES &&
    newPassword === confirmPassword &&
    !reusesCurrent;

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
          {isGoogleEnabled ? (
            <GoogleConnectionControls
              hasPassword={hasPassword}
              hasGoogle={hasGoogle}
              googleEmail={googleEmail}
            />
          ) : (
            <MethodRow
              label="Google"
              active={hasGoogle}
              activeText="Connected"
              inactiveText="Not connected"
            />
          )}
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
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        )}

        <PasswordField
          id="newPassword"
          name="newPassword"
          label="New password"
          required
          disabled={isPending}
          autoComplete="new-password"
          onChange={(e) => setNewPassword(e.target.value)}
        />

        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm new password"
          required
          disabled={isPending}
          autoComplete="new-password"
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        <PasswordRequirements
          password={newPassword}
          confirm={confirmPassword}
          currentPassword={currentPassword}
          requireDifferent={hasPassword}
        />

        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            loading={isPending}
            disabled={isPending || !canSubmit}
          >
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
