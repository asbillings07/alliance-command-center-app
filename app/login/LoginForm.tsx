"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { AuthLayout, AuthError } from "@/app/src/components";
import { Button, Input, Label, GoogleSignInButton } from "@/app/src/components/client";

const initialState: LoginState = { error: null };

/**
 * Map an Auth.js OAuth error code (surfaced as ?error=) to a friendly message.
 * Denials from the Google sign-in callback (unverified email, no invitation)
 * arrive as AccessDenied.
 */
function oauthErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === "AccessDenied") {
    return "You need an invitation to sign in with Google, and your Google email must be verified.";
  }
  return "Sign-in failed. Please try again.";
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/app";
  const oauthError = oauthErrorMessage(searchParams.get("error"));
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
      <AuthError>{state.error || oauthError}</AuthError>

      {googleEnabled && (
        <div className="space-y-4">
          <GoogleSignInButton callbackUrl={callbackUrl} />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-text-muted">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

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
          variant={googleEnabled ? "secondary" : "primary"}
          fullWidth
          loading={isPending}
        >
          {isPending ? "Signing in..." : "Sign In"}
        </Button>
      </form>
    </AuthLayout>
  );
}
