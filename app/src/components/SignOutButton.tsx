"use client";

import { logoutAction } from "@/app/logout/actions";
import { Button, type ButtonVariant } from "./Button";

type SignOutButtonProps = {
  /**
   * Visual style of the button. Defaults to `ghost` so it reads as a secondary
   * navigation affordance rather than a primary action.
   */
  variant?: ButtonVariant;
  /** Stretch the button to fill its container (e.g. sidebar nav). */
  fullWidth?: boolean;
};

/**
 * "Sign Out" button.
 *
 * Renders a form that posts to the {@link logoutAction} server action, which
 * clears the session and redirects to `/login`. No client JS beyond the form
 * submission. Safe to use from Server Components (it is itself a Client
 * Component), which is why it lives in the shared client barrel.
 */
export function SignOutButton({
  variant = "ghost",
  fullWidth = false,
}: SignOutButtonProps) {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant={variant} size="sm" fullWidth={fullWidth}>
        <SignOutGlyph />
        Sign Out
      </Button>
    </form>
  );
}

function SignOutGlyph() {
  return (
    <svg
      className="mr-2 h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
      />
    </svg>
  );
}
