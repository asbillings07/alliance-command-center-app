"use client";

import { useActionState, useState } from "react";
import { register, type RegisterState } from "./actions";
import { AuthError } from "@/app/src/components";
import {
  Button,
  Input,
  Label,
  PasswordField,
  PasswordRequirements,
  FormError,
} from "@/app/src/components/client";

const initialState: RegisterState = { error: null };

type RegisterFormProps = {
  callbackUrl: string;
  displayName?: string;
  email?: string;
};

export function RegisterForm({ callbackUrl, displayName, email }: RegisterFormProps) {
  const [state, formAction, isPending] = useActionState(register, initialState);

  // Observer state only: the fields stay uncontrolled (submitted via FormData).
  // We mirror the values to drive the live requirements checklist and inline
  // confirm-password match; the server remains the source of truth.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordsMismatch =
    confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <>
      <AuthError>{state.error}</AuthError>

      <form className="space-y-4" action={formAction}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {displayName ? (
          <>
            <input type="hidden" name="displayName" value={displayName} />
            <div>
              <Label>Display Name</Label>
              <div className="px-4 py-2 bg-surface-secondary border border-border rounded-lg text-text-muted">
                {displayName}
              </div>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              name="displayName"
              type="text"
              required
              disabled={isPending}
              autoComplete="name"
              placeholder="Display Name"
            />
          </div>
        )}

        {email ? (
          <div>
            <Label>Email</Label>
            <input type="hidden" name="email" value={email} />
            <div className="px-4 py-2 bg-surface-secondary border border-border rounded-lg text-text-muted">
              {email}
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              disabled={isPending}
              autoComplete="email"
              placeholder="Email"
            />
          </div>
        )}

        <div>
          <PasswordField
            id="password"
            name="password"
            label="Password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordRequirements password={password} />
        </div>

        <div>
          <PasswordField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm Password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Confirm Password"
            error={passwordsMismatch}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {passwordsMismatch && <FormError>Passwords do not match</FormError>}
        </div>

        <Button type="submit" variant="primary" fullWidth loading={isPending}>
          {isPending ? "Creating account..." : "Create Account"}
        </Button>
      </form>
    </>
  );
}
