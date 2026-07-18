"use client";

import { InputHTMLAttributes, forwardRef, useId, useState } from "react";
import { Input, Label } from "./Input";

export type PasswordFieldProps = {
  /** Optional label rendered above the input and associated with it. */
  label?: string;
  /** Error state styling. */
  error?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * PasswordField
 *
 * The single password input used across every auth surface (sign in, create
 * account, reset password). Wraps the shared Input with a show/hide toggle so
 * all password fields behave identically.
 *
 * The field stays uncontrolled: it submits through its `name` via FormData just
 * like a plain Input. Visibility is local presentation state only, so adopting
 * it does not change the form architecture.
 *
 * The toggle's accessible name comes from visually hidden button content (read
 * by screen readers and reachable via getByRole) rather than an aria-label, so
 * it does not collide with `getByLabel(/password/i)` selectors.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, id, error, disabled, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div>
        {label && <Label htmlFor={inputId}>{label}</Label>}
        <div className="relative">
          <Input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            error={error}
            disabled={disabled}
            className="pr-11"
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-text-muted transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="sr-only">
              {visible ? "Hide password" : "Show password"}
            </span>
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>
    );
  }
);

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.243 4.243L9.88 9.88"
      />
    </svg>
  );
}
