"use client";

import { useActionState } from "react";
import { initializePlatform, type InitializeState } from "./actions";
import { AuthError } from "@/app/src/components";
import { Button, Input, Label, PasswordField } from "@/app/src/components/client";

const initialState: InitializeState = { error: null };

export function InitializeForm() {
  const [state, formAction, isPending] = useActionState(
    initializePlatform,
    initialState
  );

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

        <PasswordField
          id="password"
          name="password"
          label="Password"
          required
          disabled={isPending}
          autoComplete="new-password"
          placeholder="Password"
        />

        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm Password"
          required
          disabled={isPending}
          autoComplete="new-password"
          placeholder="Confirm Password"
        />

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
