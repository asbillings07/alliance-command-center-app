# ADR-013: Google OAuth Sign-In

## Status

Accepted (amended 2026-07 by #144: Google sign-in resolves the internal user by `googleSubject`, not email; email becomes mutable profile data).

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

Resolution is owned by `resolveGoogleUser` so the `signIn` callback only orchestrates. The subject (`sub`) is the resolution key; a verified email is used only to link an existing account on first sign-in and to provision a new one (#144).

1. `assertVerifiedGoogleEmail(profile)` - requires `email_verified === true`; returns the normalized email. Throws `UnverifiedEmailError` otherwise.
2. `assertGoogleSubject(profile)` - returns Google's stable subject (`sub`). Throws `MissingGoogleSubjectError` if absent.
3. **By subject:** if a `User` is anchored to that `sub`, that is the returning user. Sign them in as-is; their stored email/display name may have diverged from Google and are left untouched.
4. **By email (first-time link / lazy backfill):** otherwise, if a `User` exists for the verified email, `ensureGoogleIdentity(user, sub)` links the subject (or verifies it) and throws `GoogleAccountMismatchError` if a different subject is already anchored.
5. **Provision:** otherwise `isInvitationEligible(email)` must be true (a pending beta OR alliance invitation), else `InvitationRequiredError`; then `provisionOAuthUser({ email, displayName, googleSubject: sub })` creates the user, anchoring the subject and leaving `passwordHash: null`.

`resolveGoogleUser` guarantees a postcondition of `user.googleSubject === sub` on success, which the JWT callback relies on. Failures throw typed errors (`AuthenticationError` subclasses); the callback catches them and returns `false`, which Auth.js surfaces as `AccessDenied` on `/login`.

### Identity model

**Authentication capabilities are modeled as the presence of provider-specific credentials, not as a mutually exclusive provider enum.** Business logic determines whether a login method is available by checking the corresponding capability (`passwordHash`, `googleSubject`, ...) rather than a separate provider field.

- `User.passwordHash` (optional) present -> **password login is enabled**.
- `User.googleSubject` (optional, `@unique`) present -> **Google login is enabled**. It stores Google's stable subject as the security anchor.
- A user may have **both**, enabling password + Google on the same canonical identity (email). This is a deliberate exception, primarily so the operator's break-glass account keeps a password while also using "Continue with Google." It is not an accident to be "simplified" back to one provider.
- Password login is gated purely on the capability: `if (!user.passwordHash) return null`.
- The retired `authProvider` enum could not express "both" and modeled *how a user authenticated* rather than *what an identity can do*; capabilities are the more durable and extensible abstraction (a future provider becomes another nullable column, not another enum state).

#### Security anchor: `sub` is identity, email is profile data

> **Identity providers authenticate users; AllianceHQ owns user profile data.** After an account is linked, the OAuth provider's subject is the immutable identity key, while user profile fields such as email are managed by AllianceHQ.

A verified email proves ownership *at sign-in time*, but emails can be reassigned — and AllianceHQ already lets users change their own email (verified email change). Google-linked accounts cannot yet do so; a fast-follow (#147) lifts that authorization restriction. Resolving Google sign-in by `googleSubject` rather than email is the prerequisite that makes it safe, because a user's stored email can then diverge from the email Google reports without breaking sign-in. Google sign-in therefore resolves the internal user by `googleSubject` first; the verified email is consulted only to link an existing account on the first Google sign-in (and as the lazy backfill path for accounts that predate subject storage) and to provision a new one. Once anchored, we assert the incoming `sub` matches on every subsequent sign-in and refuse to silently re-link a different one (`GoogleAccountMismatchError`), and we never resync the provider's email/name back onto the stored profile. Existing Google-only users predate subject storage; rather than a backfill script, they are anchored on their next Google sign-in (the by-email branch).

Linking is concurrency-safe. `ensureGoogleIdentity` uses a guarded write (`updateMany where { id, googleSubject: null }`) so a subject anchored by a racing sign-in between read and write is never clobbered; on a no-op it re-reads and only allows an identical subject, denying otherwise. The `@unique` constraint on `googleSubject` additionally rejects anchoring a subject already owned by a different user. Because `provisionOAuthUser` is find-or-create, the new-user branch also re-runs `ensureGoogleIdentity` on the returned user, so an email-unique race can't bypass the invariant.

### JWT invariant

After authentication, every JWT `sub` claim contains the internal `User.id`, regardless of provider. For Google, the incoming `user.id` is the Google subject; because `signIn` runs first and guarantees the account is anchored to that subject (`resolveGoogleUser`'s postcondition), the `jwt` callback resolves our cuid by `googleSubject`. Everything downstream continues to assume `session.user.id` is our own identifier.

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
- Google user whose stored AllianceHQ email differs from Google's email signs in with Google -> resolved by `googleSubject`; the stored email/display name are left unchanged (not resynced from Google).
- Legacy Google user with a null `googleSubject` signs in -> anchored via the by-email branch; subsequent sign-ins resolve by subject.
- A different Google account (different `sub`) presenting the same verified email -> access denied (`GoogleAccountMismatchError`).
- Invited email with no account signs in with Google -> account created and anchored to the subject, invitation flow continues.
- Uninvited email signs in with Google -> access denied.
- Google account with `email_verified = false` -> access denied.
- Google-only user (no `passwordHash`) attempts password login -> rejected.
- Password user continues signing in with password -> unaffected.
