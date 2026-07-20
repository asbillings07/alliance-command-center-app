import { prisma } from "@/app/src/lib/prisma";

/**
 * Session lifecycle: revocation, version validation, and current-session
 * refresh.
 *
 * These are authentication *policy* primitives, deliberately separate from
 * credential *persistence* (see app/src/lib/account.ts). Password change applies
 * this policy today by bumping `sessionVersion` atomically inside
 * `updateCredential` (one write, no race). `revokeSessions` is the same policy
 * exposed as a standalone primitive for triggers that are not credential writes
 * — e.g. "Sign out everywhere" or admin-initiated logout — reusable without any
 * auth changes.
 */

/**
 * Invalidate every previously issued session for a user by bumping the
 * authoritative session version. The next request carrying an older token fails
 * validation in the jwt callback and is signed out. The increment is atomic and
 * monotonic.
 *
 * For password changes the bump happens inline in `updateCredential` (to keep it
 * atomic with the hash write); use this primitive for non-credential triggers.
 */
export async function revokeSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}

/**
 * Read the user's current authoritative session version. Returns null when the
 * user no longer exists, so a deleted user's tokens can never validate.
 */
export async function getSessionVersion(
  userId: string
): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });

  return user?.sessionVersion ?? null;
}

/**
 * Decide whether a token's session version should continue to be honored,
 * given the current database version. Pure and framework-free so it is the
 * single, unit-testable source of truth for the validation rule.
 *
 * Tokens minted before this feature existed carry no version; treat `undefined`
 * as 0 to match the column default, so existing sessions are NOT force-logged
 * out on the deploy that introduces `sessionVersion`.
 */
export function validateSessionVersion(
  tokenVersion: number | undefined,
  dbVersion: number
): boolean {
  return (tokenVersion ?? 0) === dbVersion;
}

/**
 * Re-issue the current device's session so it survives a revocation it just
 * triggered (e.g. a user changing their own password). This mints a fresh JWT
 * carrying the new session version; all older tokens stay rejected.
 *
 * Callers state intent ("the current session needs refreshing"), not mechanism.
 * The Auth.js detail (re-running credentials sign-in) is contained here so it
 * can change (e.g. to unstable_update) without touching callers.
 *
 * The import of `signIn` is dynamic to avoid a module cycle: the auth config
 * imports the validation helpers above, so it cannot be imported at this file's
 * top level.
 */
export async function refreshCurrentSession(
  email: string,
  password: string
): Promise<void> {
  const { signIn } = await import("@/app/src/lib/auth");
  await signIn("credentials", { email, password, redirect: false });
}
