"use server";

import { signIn } from "@/app/src/lib/auth";
import { sanitizeCallbackUrl } from "@/app/src/lib/auth/callbackUrl";

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
  await signIn("google", { redirectTo: callbackUrl });
}
