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
2. `assertGoogleSubject(profile)` - returns Google's stable subject (`sub`). Throws `MissingGoogleSubjectError` if absent.
3. If a `User` already exists for that email, `ensureGoogleIdentity(user, sub)` links the subject on the first Google sign-in (backfill), verifies it on later sign-ins, and throws `GoogleAccountMismatchError` if a different subject is already anchored. Allowed once the identity is confirmed.
4. Otherwise, `isInvitationEligible(email)` must be true (a pending beta OR alliance invitation). If not, throw `InvitationRequiredError`.
5. `provisionOAuthUser({ email, displayName, googleSubject: sub })` creates the user, anchoring the subject and leaving `passwordHash: null`.

Failures throw typed errors (`AuthenticationError` subclasses); the callback catches them and returns `false`, which Auth.js surfaces as `AccessDenied` on `/login`.

### Identity model

**Authentication capabilities are modeled as the presence of provider-specific credentials, not as a mutually exclusive provider enum.** Business logic determines whether a login method is available by checking the corresponding capability (`passwordHash`, `googleSubject`, ...) rather than a separate provider field.

- `User.passwordHash` (optional) present -> **password login is enabled**.
- `User.googleSubject` (optional, `@unique`) present -> **Google login is enabled**. It stores Google's stable subject as the security anchor.
- A user may have **both**, enabling password + Google on the same canonical identity (email). This is a deliberate exception, primarily so the operator's break-glass account keeps a password while also using "Continue with Google." It is not an accident to be "simplified" back to one provider.
- Password login is gated purely on the capability: `if (!user.passwordHash) return null`.
- The retired `authProvider` enum could not express "both" and modeled *how a user authenticated* rather than *what an identity can do*; capabilities are the more durable and extensible abstraction (a future provider becomes another nullable column, not another enum state).

#### Security anchor: email identifies, `sub` is identity

A verified email proves ownership *at sign-in time*, but emails can be reassigned. Once a `googleSubject` is anchored to a user, we assert the incoming `sub` matches on every subsequent Google sign-in and refuse to silently re-link a different one (`GoogleAccountMismatchError`). Existing Google-only users predate subject storage; rather than a backfill script, they are anchored on their next Google sign-in (the "no anchor yet" branch).

### JWT invariant

After authentication, every JWT `sub` claim contains the internal `User.id`, regardless of provider. For Google, the incoming `user.id` is the Google subject, so the `jwt` callback resolves our cuid by verified email. Everything downstream continues to assume `session.user.id` is our own identifier.

### Intentional simplification

Account linking is **automatic** on a verified-email match: there is no "link account while signed in" UI or confirmation step. For verified Google emails during beta this is a reasonable trade-off and keeps the flow simple. An explicit linking/unlinking UX is deferred until there's a product need.

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

- Linking is automatic (no explicit link/unlink UX yet).
- Only the Google subject is persisted; no broader OAuth metadata (tokens, etc.).
- Each additional provider adds another nullable capability column (acceptable, and simpler than an `Account` table).

## Configuration

Google is enabled only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are both set, so local/CI environments without credentials are unaffected. Redirect URI: `<origin>/api/auth/callback/google`.

## Manual Acceptance Checklist

- Existing password user signs in with Google (same email) -> Google subject linked; both password and Google logins then work.
- Same user signs in with Google again -> subject verified, no duplicate/relink.
- A different Google account (different `sub`) presenting the same verified email -> access denied (`GoogleAccountMismatchError`).
- Invited email with no account signs in with Google -> account created and anchored to the subject, invitation flow continues.
- Uninvited email signs in with Google -> access denied.
- Google account with `email_verified = false` -> access denied.
- Google-only user (no `passwordHash`) attempts password login -> rejected.
- Password user continues signing in with password -> unaffected.
