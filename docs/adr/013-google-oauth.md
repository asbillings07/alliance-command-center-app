# ADR-013: Google OAuth Sign-In

## Status

Accepted

## Guiding Principle

> Alliance Command Center treats OAuth providers as authentication mechanisms only. Authorization and account eligibility remain governed by the platform's invitation model and verified email identity.

Authentication establishes identity. Authorization determines eligibility. AllianceHQ intentionally keeps these concerns separate so authentication providers remain interchangeable while platform access continues to be governed by invitation and domain rules.

## Context

The platform is invitation-only. Registration locks the email to the invitation and requires a password. For the upcoming beta we want to reduce onboarding friction with "Continue with Google" while preserving the invitation model.

The existing auth stack is Auth.js v5 with a **Credentials** provider, **JWT** sessions, and **no Prisma adapter**. Identity is the user's email (`User.email` is unique). There are no `Account`, `Session`, or `VerificationToken` tables.

## Decision

Add Google as an additional authentication provider using a **custom `signIn` callback**, not the Prisma adapter. Google proves the user owns a verified email; the invitation model decides whether that email may access the platform.

### Layers

| Layer | Responsibility | Location |
|-------|----------------|----------|
| Google profile | Who are you? | Auth.js Google provider |
| Identity | Is this Google account trustworthy? | `identity/google.ts` - `assertVerifiedGoogleEmail` |
| Eligibility | Are you allowed onto the platform? | `identity/eligibility.ts` - `isInvitationEligible` |
| Provisioning | How is this person represented in our domain? | `provisionOAuthUser` |

### Sign-in flow (Google)

1. `assertVerifiedGoogleEmail(profile)` - requires `email_verified === true`; returns the normalized email. Throws `UnverifiedEmailError` otherwise.
2. If a `User` already exists for that email, allow (existing account reused - linking by verified email; no `Account` table needed).
3. Otherwise, `isInvitationEligible(email)` must be true (a pending beta OR alliance invitation). If not, throw `InvitationRequiredError`.
4. `provisionOAuthUser({ email, displayName, provider: "GOOGLE" })` creates the user (`authProvider: GOOGLE`, `passwordHash: null`).

Failures throw typed errors (`AuthenticationError` subclasses); the callback catches them and returns `false`, which Auth.js surfaces as `AccessDenied` on `/login`.

### Identity model

- `User.passwordHash` is now optional (OAuth users have no password).
- `User.authProvider` (`enum AuthProvider { PASSWORD, GOOGLE }`, default `PASSWORD`) records **how** a user authenticates, using domain terminology rather than the framework's provider name (`CREDENTIALS`).
- Password login is rejected for non-`PASSWORD` accounts.

### JWT invariant

After authentication, every JWT `sub` claim contains the internal `User.id`, regardless of provider. For Google, the incoming `user.id` is the Google subject, so the `jwt` callback resolves our cuid by verified email. Everything downstream continues to assume `session.user.id` is our own identifier.

### Intentional simplification

During beta, a user authenticates using exactly one provider (`User.authProvider`). Multiple authentication providers per user (linked accounts) are intentionally deferred; supporting them would require additional schema.

## Why no Prisma adapter

We already own the `User` lifecycle, invitations, JWT sessions, and a clean domain model, with email as canonical identity. Adding `Account`/`Session`/`VerificationToken` tables solely because Google exists would complicate persistence without solving a current problem. If AllianceHQ later supports several providers, passkeys, or enterprise SSO, that is the point to revisit the adapter.

## Consequences

### Benefits

- Minimal schema.
- No framework-specific persistence.
- Invitation model remains authoritative.
- JWT remains unchanged.
- Existing authorization logic is preserved.

### Trade-offs

- Only one authentication provider per user.
- No linked accounts.
- OAuth metadata is not persisted.
- Future multi-provider support will require additional schema.

## Configuration

Google is enabled only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are both set, so local/CI environments without credentials are unaffected. Redirect URI: `<origin>/api/auth/callback/google`.

## Manual Acceptance Checklist

- Existing password user signs in with Google (same email) -> existing account reused.
- Invited email with no account signs in with Google -> account created, invitation flow continues.
- Uninvited email signs in with Google -> access denied.
- Google account with `email_verified = false` -> access denied.
- OAuth-only user attempts password login -> rejected.
- Password user continues signing in with password -> unaffected.
