"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestAccess, type RequestAccessState } from "./actions";
import { AuthError } from "@/app/src/components";
import { Button, Input, Label, Textarea } from "@/app/src/components/client";

const initialState: RequestAccessState = { status: "idle", error: null };

export function RequestAccessForm() {
  const [state, formAction, isPending] = useActionState(
    requestAccess,
    initialState
  );

  if (state.status === "success") {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p className="text-sm text-text-secondary">
          Thanks for your interest! We&apos;ve received your request and will
          reach out by email if we&apos;re able to invite you to the beta.
        </p>
        <div className="mt-6">
          <Button href="/" variant="secondary" fullWidth>
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <AuthError>{state.error}</AuthError>

      <form className="space-y-4" action={formAction}>
        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            required
            disabled={isPending}
            autoComplete="name"
            placeholder="Your name"
          />
        </div>

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
          <Label htmlFor="allianceName">Alliance name (optional)</Label>
          <Input
            id="allianceName"
            name="allianceName"
            type="text"
            disabled={isPending}
            autoComplete="organization"
            placeholder="Your alliance"
          />
        </div>

        <div>
          <Label htmlFor="message">
            Why are you interested in Alliance Command Center? (optional)
          </Label>
          <Textarea
            id="message"
            name="message"
            rows={4}
            disabled={isPending}
            placeholder="Tell us a little about your alliance and what you're hoping to do."
          />
        </div>

        <Button type="submit" variant="primary" fullWidth loading={isPending}>
          {isPending ? "Sending request..." : "Request Access"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-muted">
        Already have an invitation?{" "}
        <Link href="/redeem" className="text-primary hover:underline">
          Redeem it here
        </Link>
      </p>
    </>
  );
}
