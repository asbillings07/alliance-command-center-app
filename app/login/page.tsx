"use client";

import { Suspense } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { AuthLayout, AuthError, Button, Input, Label } from "@/app/src/components";

const initialState: LoginState = { error: null };

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/app";
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <AuthLayout
      title="Alliance Command Center"
      subtitle="Sign in to continue"
      footer={
        <div className="space-y-2">
          <p>
            Have a beta code?{" "}
            <Link href="/redeem" className="text-primary hover:text-primary-hover underline">
              Redeem it here
            </Link>
          </p>
          <p>
            Invited to an alliance?{" "}
            <Link href="/invite" className="text-primary hover:text-primary-hover underline">
              Enter invitation code
            </Link>
          </p>
        </div>
      }
    >
      <AuthError>{state.error}</AuthError>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

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

        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            disabled={isPending}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={isPending}
        >
          {isPending ? "Signing in..." : "Sign In"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-text-muted">Loading...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
