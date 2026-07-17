"use client";

import { signInWithGoogle } from "@/app/src/lib/auth/googleSignInAction";
import { Button } from "@/app/src/components/client";

type GoogleSignInButtonProps = {
  callbackUrl: string;
  /**
   * Optional class override for contexts that don't use the design-token
   * {@link Button} (e.g. the dark-themed redeem page). When provided, a native
   * button is rendered with these classes; otherwise the shared Button is used.
   * The form, glyph, label and ARIA stay shared so the two flows can't drift.
   */
  className?: string;
};

/**
 * "Continue with Google" button.
 *
 * Renders a form that posts to the {@link signInWithGoogle} server action,
 * preserving `callbackUrl` through the OAuth round-trip. Only render this when
 * Google OAuth is enabled (see isGoogleAuthEnabled). Safe to use from Server
 * Components (it is itself a Client Component).
 */
export function GoogleSignInButton({
  callbackUrl,
  className,
}: GoogleSignInButtonProps) {
  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {className ? (
        <button type="submit" className={className}>
          <GoogleGlyph />
          Continue with Google
        </button>
      ) : (
        <Button type="submit" variant="primary" fullWidth>
          <GoogleGlyph />
          Continue with Google
        </Button>
      )}
    </form>
  );
}

function GoogleGlyph() {
  return (
    <svg
      className="mr-2 h-4 w-4"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.1s2.69-6.1 6-6.1c1.88 0 3.15.8 3.87 1.49l2.64-2.54C16.9 2.9 14.7 2 12 2 6.98 2 2.9 6.03 2.9 11.1S6.98 20.2 12 20.2c6.05 0 7.86-4.24 7.86-6.44 0-.44-.05-.78-.11-1.12H12z"
      />
    </svg>
  );
}
