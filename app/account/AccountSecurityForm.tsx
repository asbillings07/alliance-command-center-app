"use client";

import { useActionState, useState, type ReactNode } from "react";
import { updatePassword, type UpdateProfileState } from "./actions";
import { Button, PasswordField } from "@/app/src/components/client";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
} from "@/app/src/lib/password";

const passwordByteLength = (value: string) =>
  new TextEncoder().encode(value).length;

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

type RequirementStatus = "pending" | "met" | "error";

function RequirementIcon({ status }: { status: RequirementStatus }) {
  if (status === "met") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5 shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 0 1 0 1.42l-7.5 7.5a1 1 0 0 1-1.42 0l-3.5-3.5a1 1 0 1 1 1.42-1.42l2.79 2.79 6.79-6.79a1 1 0 0 1 1.42 0Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5 shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-3.5 w-3.5 shrink-0"
    >
      <circle cx="10" cy="10" r="5" />
    </svg>
  );
}

function Requirement({
  status,
  children,
}: {
  status: RequirementStatus;
  children: ReactNode;
}) {
  const tone =
    status === "met"
      ? "text-success"
      : status === "error"
        ? "text-danger"
        : "text-text-muted";
  return (
    <li className={`flex items-center gap-2 ${tone}`}>
      <RequirementIcon status={status} />
      <span>{children}</span>
    </li>
  );
}

/**
 * Live password requirements. Renders the rules up front (neutral) so users know
 * what's expected before typing, then updates as they type so they can confirm
 * the password is acceptable BEFORE submitting rather than discovering it after.
 *
 * Only the client-verifiable rules live here (length, confirmation match). The
 * bcrypt 72-byte cap is surfaced only if a user actually exceeds it — virtually
 * no one does, so advertising it up front would be noise. Server-only checks
 * (current password correct, new password differs from old) can't be known here
 * and remain reported after submit.
 */
function PasswordChecklist({
  password,
  confirm,
}: {
  password: string;
  confirm: string;
}) {
  const lengthStatus: RequirementStatus =
    password.length >= PASSWORD_MIN_LENGTH ? "met" : "pending";

  const confirmStarted = confirm.length > 0;
  const matchStatus: RequirementStatus = !confirmStarted
    ? "pending"
    : password === confirm
      ? "met"
      : "error";

  const tooLong = passwordByteLength(password) > PASSWORD_MAX_BYTES;

  return (
    <ul className="space-y-1 text-xs" aria-live="polite">
      <Requirement status={lengthStatus}>
        At least {PASSWORD_MIN_LENGTH} characters
      </Requirement>
      <Requirement status={matchStatus}>
        {matchStatus === "error" ? "Passwords don't match" : "Passwords match"}
      </Requirement>
      {tooLong && (
        <Requirement status="error">
          Too long — use {PASSWORD_MAX_BYTES} characters or fewer
        </Requirement>
      )}
    </ul>
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

  // Mirror the password fields so the requirements checklist can react as the
  // user types. The inputs stay uncontrolled (submitted via FormData by name);
  // this state drives display only.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Everything we can verify on the client before allowing a submit. Server-only
  // checks (current password correct, new password differs from old) still run
  // and can surface an error afterward, but this prevents an obviously-doomed
  // submit.
  const canSubmit =
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    passwordByteLength(newPassword) <= PASSWORD_MAX_BYTES &&
    newPassword === confirmPassword &&
    (!hasPassword || currentPassword.length > 0);

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

        <PasswordChecklist password={newPassword} confirm={confirmPassword} />

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
