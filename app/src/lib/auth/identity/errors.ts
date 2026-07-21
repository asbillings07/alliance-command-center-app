/**
 * Authentication errors.
 *
 * These represent failures that occur while establishing identity or
 * determining account eligibility during an OAuth sign-in. The NextAuth
 * `signIn` callback catches them and translates them into `return false`
 * (Auth.js AccessDenied). Modeling them as typed errors keeps the callback
 * thin, makes each failure independently testable, and leaves room to surface
 * distinct messages to the user later.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Google reported the email is not verified, or no email was present. */
export class UnverifiedEmailError extends AuthenticationError {
  constructor(message = "Google email is not verified") {
    super(message);
  }
}

/** The email has no account and no pending invitation, so it may not join. */
export class InvitationRequiredError extends AuthenticationError {
  constructor(message = "An invitation is required to sign in") {
    super(message);
  }
}

/** Google OAuth is not configured for this deployment. */
export class OAuthDisabledError extends AuthenticationError {
  constructor(message = "Google sign-in is not enabled") {
    super(message);
  }
}

/** Google returned no subject (`sub`) claim; identity cannot be anchored. */
export class MissingGoogleSubjectError extends AuthenticationError {
  constructor(message = "Google profile is missing a subject") {
    super(message);
  }
}

/**
 * The incoming Google subject does not match the one already anchored to this
 * identity (or that subject is already anchored to a different user). We refuse
 * to silently re-link: email alone must not be enough to take over an account.
 */
export class GoogleAccountMismatchError extends AuthenticationError {
  constructor(
    message = "This email is linked to a different Google account"
  ) {
    super(message);
  }
}

/**
 * The email matches an account whose owner explicitly disconnected Google
 * (`googleAutoLinkBlockedAt` is set, ADR-013 #131). Normal sign-in must not
 * silently re-link by email — the disconnection is a durable, intentional
 * state. The user can reconnect explicitly from Account settings.
 */
export class GoogleAutoLinkBlockedError extends AuthenticationError {
  constructor(
    message = "This account was disconnected from Google sign-in. Sign in with your password, then reconnect Google from Account settings."
  ) {
    super(message);
  }
}
