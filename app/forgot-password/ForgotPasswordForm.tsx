"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";
import { AuthLayout, AuthError } from "@/app/src/components";
import { Button, Input, Label } from "@/app/src/components/client";

const initialState: ForgotPasswordState = { submitted: false, error: null };

const backToLogin = (
  <p>
    Remembered your password?{" "}
    <Link
      href="/login"
      className="text-primary hover:text-primary-hover underline"
    >
      Sign in
    </Link>
  </p>
);

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialState
  );

  if (state.submitted) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="Password reset requested"
        footer={backToLogin}
      >
        <p className="text-sm text-text-secondary">
          If an account exists for that email, we&apos;ve sent a link to reset
          your password. The link expires in one hour.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={backToLogin}
    >
      <AuthError>{state.error}</AuthError>

      <form action={formAction} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            disabled={isPending}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>

        <Button type="submit" variant="primary" fullWidth loading={isPending}>
          {isPending ? "Sending..." : "Send reset link"}
        </Button>
      </form>
    </AuthLayout>
  );
}
