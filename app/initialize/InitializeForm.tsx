"use client";

import { useActionState, useState } from "react";
import { initializePlatform, type InitializeState } from "./actions";
import { AuthError } from "@/app/src/components";
import {
  Button,
  Input,
  Label,
  PasswordField,
  PasswordRequirements,
  FormError,
} from "@/app/src/components/client";

const initialState: InitializeState = { error: null };

export function InitializeForm() {
  const [state, formAction, isPending] = useActionState(
    initializePlatform,
    initialState
  );

  // Observer state only: fields stay uncontrolled (submitted via FormData).
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordsMismatch =
    confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <>
      <AuthError>{state.error}</AuthError>

      <form className="space-y-4" action={formAction}>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            disabled={isPending}
            autoComplete="email"
            placeholder="admin@example.com"
          />
        </div>

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

        <div>
          <Label htmlFor="bootstrapSecret">Bootstrap Secret</Label>
          <Input
            id="bootstrapSecret"
            name="bootstrapSecret"
            type="password"
            disabled={isPending}
            autoComplete="off"
            placeholder="Bootstrap Secret"
          />
        </div>

        <Button type="submit" variant="primary" fullWidth loading={isPending}>
          {isPending ? "Initializing..." : "Initialize Platform"}
        </Button>
      </form>
    </>
  );
}
