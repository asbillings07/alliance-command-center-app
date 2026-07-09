"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function InviteCodePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    
    if (!trimmedCode) {
      setError("Please enter an invitation code");
      return;
    }

    // Validate format: ABC-123-XYZ (11 chars, letters/numbers with dashes)
    const codePattern = /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/;
    if (!codePattern.test(trimmedCode)) {
      setError("Invalid code format. Expected format: ABC-123-XYZ");
      return;
    }

    router.push(`/invite/code?code=${encodeURIComponent(trimmedCode)}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
      <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#3B82F6]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#3B82F6]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Enter Invitation Code
          </h1>
          <p className="text-[#9CA3AF]">
            Enter the code you received to join an alliance.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-md p-3 text-sm text-[#EF4444]">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="code"
              className="block text-sm font-medium text-[#D1D5DB] mb-1.5"
            >
              Invitation Code
            </label>
            <input
              type="text"
              id="code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
              placeholder="ABC-123-XYZ"
              maxLength={11}
              className="w-full px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937] text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent text-sm text-center font-mono tracking-wider uppercase"
              autoComplete="off"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="w-full px-4 py-2.5 bg-[#3B82F6] text-white rounded-md hover:bg-[#2563EB] text-sm font-medium"
          >
            Continue
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-[#374151] text-center">
          <p className="text-sm text-[#9CA3AF]">
            Already a member?{" "}
            <Link href="/login" className="text-[#3B82F6] hover:text-[#60A5FA]">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
