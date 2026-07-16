"use client";

import { useActionState } from "react";
import { register, type RegisterState } from "./actions";
import { AuthError } from "@/app/src/components";
import { Button, Input, Label } from "@/app/src/components/client";

const initialState: RegisterState = { error: null };

type RegisterFormProps = {
  callbackUrl: string;
  displayName?: string;
  email?: string;
};

export function RegisterForm({ callbackUrl, displayName, email }: RegisterFormProps) {
  const [state, formAction, isPending] = useActionState(register, initialState);

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
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Password"
          />
        </div>

        <div>
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Confirm Password"
          />
        </div>

        <Button type="submit" variant="primary" fullWidth loading={isPending}>
          {isPending ? "Creating account..." : "Create Account"}
        </Button>
      </form>
    </>
  );
}
