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
