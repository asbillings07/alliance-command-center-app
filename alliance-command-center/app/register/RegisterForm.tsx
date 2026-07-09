"use client";

import { useActionState } from "react";
import { register, type RegisterState } from "./actions";

const initialState: RegisterState = { error: null };

type RegisterFormProps = {
  callbackUrl: string;
  displayName: string;
};

export function RegisterForm({ callbackUrl, displayName }: RegisterFormProps) {
  const [state, formAction, isPending] = useActionState(register, initialState);

  return (
    <>
      {state.error && (
        <p className="text-red-500 text-sm text-center">{state.error}</p>
      )}

      <form
        className="flex flex-col gap-2 w-full rounded-md border border-gray-300 p-4"
        action={formAction}
      >
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <input type="hidden" name="displayName" value={displayName} />
        
        <div className="p-2 border border-gray-200 rounded-md bg-gray-50 text-gray-700">
          {displayName}
        </div>
        
        <input
          className="p-2 border border-gray-300 rounded-md text-gray-800"
          name="email"
          type="email"
          required
          disabled={isPending}
          autoComplete="email"
          aria-label="Email"
          placeholder="Email"
        />
        <input
          className="p-2 border border-gray-300 rounded-md text-gray-800"
          name="password"
          type="password"
          required
          disabled={isPending}
          autoComplete="new-password"
          aria-label="Password"
          placeholder="Password"
        />
        <input
          className="p-2 border border-gray-300 rounded-md text-gray-800"
          name="confirmPassword"
          type="password"
          required
          disabled={isPending}
          autoComplete="new-password"
          aria-label="Confirm Password"
          placeholder="Confirm Password"
        />

        <button
          className="p-2 bg-blue-500 text-white w-full rounded-md"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </>
  );
}
