"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/app/src/lib/auth";
import { sanitizeCallbackUrl } from "@/app/src/lib/auth/callbackUrl";
import { isGoogleAuthEnabled } from "@/app/src/lib/auth/identity/google";

/**
 * Begin a Google OAuth sign-in.
 *
 * Follows the app's server-action-only `signIn` pattern. `redirectTo` is
 * preserved through the OAuth round-trip so invited users return to the
 * invitation flow (e.g. /redeem/[token]) after authenticating. The callback URL
 * is sanitized to same-origin relative paths to prevent open redirects.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const callbackUrl = sanitizeCallbackUrl(
    formData.get("callbackUrl") as string | null,
  );

  // The Google provider is only registered when OAuth is configured. Guard
  // against calls that arrive when it's disabled (direct POST, stale UI,
  // misconfiguration): calling signIn("google") would throw a 500, so bounce
  // back to /login instead.
  if (!isGoogleAuthEnabled()) {
    redirect("/login");
  }

  await signIn("google", { redirectTo: callbackUrl });
}
