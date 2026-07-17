"use server";

import { signIn } from "@/app/src/lib/auth";

/**
 * Begin a Google OAuth sign-in.
 *
 * Follows the app's server-action-only `signIn` pattern. `redirectTo` is
 * preserved through the OAuth round-trip so invited users return to the
 * invitation flow (e.g. /redeem/[token]) after authenticating.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const callbackUrl = (formData.get("callbackUrl") as string) || "/app";
  await signIn("google", { redirectTo: callbackUrl });
}
