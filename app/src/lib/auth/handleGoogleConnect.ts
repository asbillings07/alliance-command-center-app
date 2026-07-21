import {
  assertGoogleSubject,
  assertVerifiedGoogleEmail,
  type GoogleProfile,
} from "@/app/src/lib/auth/identity/google";
import {
  AuthenticationError,
  UnverifiedEmailError,
} from "@/app/src/lib/auth/identity/errors";
import {
  clearLinkIntent,
  linkGoogleToUser,
  logGoogleConnectionEvent,
  setConnectResult,
  type ReadLinkIntentResult,
} from "@/app/src/lib/auth/googleConnection";
import { getSessionVersion } from "@/app/src/lib/auth/session";

/**
 * Handle the explicit connect / fail-closed path of a Google callback (#131).
 *
 * Reached from the `signIn` callback only when a link-intent cookie was present
 * (status !== "absent"). Extracted from the Auth.js config so these
 * security-critical branches are directly unit-testable in isolation from
 * NextAuth: the callback orchestrates, this owns the connect policy.
 *
 * Invariants:
 * - This NEVER falls through to a normal sign-in. An untrusted intent is denied,
 *   so a stale or tampered intent can't switch the browser to a different
 *   account.
 * - The single-use intent is cleared on every terminal outcome.
 * - A signed connect-result cookie carries the outcome back to /account for a
 *   banner. Denials return false (Auth.js AccessDenied); the caller's existing
 *   session is untouched, and identity is never switched on failure.
 */
export async function handleGoogleConnect(
  intent: Exclude<ReadLinkIntentResult, { status: "absent" }>,
  profile: GoogleProfile | undefined
): Promise<boolean> {
  // Single-use: consume the intent regardless of how this attempt resolves.
  await clearLinkIntent();

  if (intent.status === "invalid") {
    // Fail closed: an attempt we no longer trust is denied, never downgraded to
    // a normal sign-in.
    await setConnectResult("intent_expired");
    logGoogleConnectionEvent("connect_denied", {
      userId: "unknown",
      reason: "invalid_intent",
    });
    return false;
  }

  const { userId } = intent;
  try {
    if (!profile) {
      throw new Error("Google connect callback received no profile");
    }
    // Connect links by subject bound to the current user via the intent; the
    // OAuth challenge itself is the proof, so we anchor on the subject. The
    // verified email is captured only as display metadata (never as identity).
    const email = assertVerifiedGoogleEmail(profile);
    const googleSubject = assertGoogleSubject(profile);

    // Session-version binding: a password change or session revocation during
    // the OAuth round trip bumps sessionVersion and invalidates this intent.
    const currentVersion = await getSessionVersion(userId);
    if (currentVersion === null || currentVersion !== intent.sessionVersion) {
      await setConnectResult("intent_expired");
      logGoogleConnectionEvent("connect_denied", {
        userId,
        reason: "session_version_mismatch",
      });
      return false;
    }

    await linkGoogleToUser(userId, googleSubject, email);
    await setConnectResult("connected");
    logGoogleConnectionEvent("connected", { userId });
    return true;
  } catch (error) {
    if (error instanceof UnverifiedEmailError) {
      // The Google email isn't verified: distinct from "taken" so the banner can
      // tell the user to verify it with Google and try again. (Checked before
      // the generic AuthenticationError branch since it is a subclass.)
      await setConnectResult("email_unverified");
      logGoogleConnectionEvent("connect_denied", {
        userId,
        reason: "email_unverified",
      });
      return false;
    }
    if (error instanceof AuthenticationError) {
      // Subject already anchored elsewhere / mismatch: refuse without switching
      // identity.
      await setConnectResult("already_in_use");
      logGoogleConnectionEvent("connect_denied", {
        userId,
        reason: "subject_unavailable",
      });
      return false;
    }
    // Unexpected: deny with a generic banner rather than 500-ing the account
    // flow, but keep the error visible in logs/monitoring. Identity is never
    // switched on failure.
    await setConnectResult("unavailable");
    logGoogleConnectionEvent("connect_denied", {
      userId,
      reason: "unexpected_error",
    });
    console.error("Unexpected error during Google connect", error);
    return false;
  }
}
