"use server";

import { signOut } from "@/app/src/lib/auth";

/**
 * End the current session.
 *
 * Follows the app's server-action-only auth pattern (mirrors
 * {@link signInWithGoogle}). Auth.js clears the session cookie and redirects to
 * `/login`.
 *
 * Sessions are stateless JWTs, so this only ends the caller's current session.
 * Revoking every active session on sign-out (and on password change) is tracked
 * as future work in ADR-014.
 */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
