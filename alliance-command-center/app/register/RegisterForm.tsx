"use client";

import { useActionState } from "react";
import { register, type RegisterState } from "./actions";

const initialState: RegisterState = { error: null };

type RegisterFormProps = {
  callbackUrl: string;
  displayName?: string;
  email?: string;
  darkMode?: boolean;
};

export function RegisterForm({ callbackUrl, displayName, email, darkMode = false }: RegisterFormProps) {
  const [state, formAction, isPending] = useActionState(register, initialState);

  const inputClass = darkMode
    ? "w-full px-4 py-3 bg-[#1F2937] border border-[#374151] rounded-md text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
    : "p-2 border border-gray-300 rounded-md text-gray-800";

  const labelClass = darkMode
    ? "block text-sm font-medium text-[#D1D5DB] mb-1.5"
    : "sr-only";

  const errorClass = darkMode
    ? "p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-md text-sm text-[#EF4444]"
    : "text-red-500 text-sm text-center";

  const buttonClass = darkMode
    ? "w-full px-4 py-3 bg-[#3B82F6] text-white font-medium rounded-md hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
    : "p-2 bg-blue-500 text-white w-full rounded-md disabled:opacity-50";

  return (
    <>
      {state.error && <div className={errorClass}>{state.error}</div>}

      <form className="flex flex-col gap-4" action={formAction}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {displayName ? (
          <>
            <input type="hidden" name="displayName" value={displayName} />
            <div>
              <label className={labelClass}>Display Name</label>
              <div className={darkMode 
                ? "px-4 py-3 bg-[#1F2937] border border-[#374151] rounded-md text-[#9CA3AF]"
                : "p-2 border border-gray-200 rounded-md bg-gray-50 text-gray-700"
              }>
                {displayName}
              </div>
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="displayName" className={labelClass}>
              Display Name
            </label>
            <input
              id="displayName"
              className={inputClass}
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
            <label className={labelClass}>Email</label>
            <input type="hidden" name="email" value={email} />
            <div className={darkMode 
              ? "px-4 py-3 bg-[#1F2937] border border-[#374151] rounded-md text-[#9CA3AF]"
              : "p-2 border border-gray-200 rounded-md bg-gray-50 text-gray-700"
            }>
              {email}
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              className={inputClass}
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
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            className={inputClass}
            name="password"
            type="password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Password"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className={labelClass}>
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            className={inputClass}
            name="confirmPassword"
            type="password"
            required
            disabled={isPending}
            autoComplete="new-password"
            placeholder="Confirm Password"
          />
        </div>

        <button className={buttonClass} type="submit" disabled={isPending}>
          {isPending ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </>
  );
}
