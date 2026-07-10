"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/app";
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
      <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#F9FAFB]">
            Alliance Command Center
          </h1>
          <p className="text-[#9CA3AF] mt-1">Sign in to continue</p>
        </div>

        {state.error && (
          <div className="mb-4 p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-md">
            <p className="text-sm text-[#EF4444]">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[#D1D5DB] mb-2"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              disabled={isPending}
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full px-4 py-3 bg-[#1F2937] border border-[#374151] rounded-md text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#D1D5DB] mb-2"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              disabled={isPending}
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-[#1F2937] border border-[#374151] rounded-md text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full px-4 py-3 bg-[#3B82F6] text-white font-medium rounded-md hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-[#374151] space-y-3">
          <p className="text-center text-sm text-[#9CA3AF]">
            Have a beta code?{" "}
            <Link
              href="/redeem"
              className="text-[#3B82F6] hover:text-[#60A5FA]"
            >
              Redeem it here
            </Link>
          </p>
          <p className="text-center text-sm text-[#9CA3AF]">
            Invited to an alliance?{" "}
            <Link
              href="/invite"
              className="text-[#3B82F6] hover:text-[#60A5FA]"
            >
              Enter invitation code
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}