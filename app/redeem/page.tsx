"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthLayout, AuthError } from "@/app/src/components";
import { Button, Label } from "@/app/src/components/client";

function KeyIcon() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    </svg>
  );
}

export default function RedeemPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();

    if (!trimmedCode) {
      setError("Please enter a beta code");
      return;
    }

    // Validate format: ABC-123 (7 chars, letters/numbers with dash)
    const codePattern = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
    if (!codePattern.test(trimmedCode)) {
      setError("Invalid code format. Expected format: ABC-123");
      return;
    }

    router.push(`/redeem/code?code=${encodeURIComponent(trimmedCode)}`);
  };

  return (
    <AuthLayout
      icon={<KeyIcon />}
      title="Alliance Command Center"
      subtitle="Enter your beta code to get started"
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:text-primary-hover underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthError>{error}</AuthError>

        <div>
          <Label htmlFor="code">Beta Code</Label>
          <input
            type="text"
            id="code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="ABC-123"
            maxLength={7}
            className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-text-primary placeholder-text-muted text-center font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            autoComplete="off"
            autoFocus
          />
        </div>

        <Button type="submit" variant="primary" fullWidth>
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}
