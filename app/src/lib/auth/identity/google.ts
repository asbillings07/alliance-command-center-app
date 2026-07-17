import { UnverifiedEmailError } from "./errors";

/**
 * Google identity (authentication layer).
 *
 * This module answers a single question: "Is this Google account a trustworthy
 * identity, and if so, what is its canonical email?" It contains no business
 * rules about who is allowed onto the platform (see identity/eligibility.ts).
 */

/** The subset of the Google OpenID profile we rely on. */
export type GoogleProfile = {
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
};

/**
 * Whether Google OAuth is configured for this deployment.
 * Used to gate both the provider registration and the sign-in UI so that
 * environments without credentials (local, CI) are unaffected.
 */
export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/**
 * Assert that the Google profile represents a verified email and return the
 * normalized (lowercased, trimmed) email.
 *
 * Throws {@link UnverifiedEmailError} when the email is missing or unverified.
 * This is the security boundary: only verified Google emails may proceed,
 * preventing someone from claiming an invitation tied to an email they don't own.
 */
export function assertVerifiedGoogleEmail(profile: GoogleProfile): string {
  if (profile.email_verified !== true) {
    throw new UnverifiedEmailError();
  }

  const email = profile.email?.toLowerCase().trim();
  if (!email) {
    throw new UnverifiedEmailError("Google profile is missing an email");
  }

  return email;
}
