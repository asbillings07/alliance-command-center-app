"use client";

import { useActionState, useState } from "react";
import { resetPasswordAction, type ResetPasswordState } from "./actions";
import { AuthError } from "@/app/src/components";
import {
  Button,
  PasswordField,
  PasswordRequirements,
} from "@/app/src/components/client";

const initialState: ResetPasswordState = { error: null };

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    resetPasswordAction,
    initialState
  );

  // Observer state only: fields stay uncontrolled (submitted via FormData). This
  // drives the live requirements checklist as the user types.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordsMismatch =
    confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <>
      <AuthError>{state.error}</AuthError>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <PasswordField
            id="password"
            name="password"
            label="New Password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="New password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm New Password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Confirm new password"
            error={passwordsMismatch}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <PasswordRequirements password={password} confirm={confirmPassword} />
        </div>

        <Button type="submit" variant="primary" fullWidth loading={isPending}>
          {isPending ? "Resetting..." : "Reset Password"}
        </Button>
      </form>
    </>
  );
}
