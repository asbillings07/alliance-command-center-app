# ADR-015: Verified Email Change

## Status

Accepted (amended 2026-07 by #147: email-change eligibility is based on the ability to re-authenticate with a password, not on which providers are linked. #144 made `googleSubject` the identity anchor, so the original Google-linked restriction is lifted — any account with a password credential can change its email.)

## Guiding Principle

> A verified email change is a single-use, two-proof, atomic identity transition that invalidates every existing session.

Changing `displayName` answers "what should other leaders call me?". Changing `email` answers "who am I?". Email is the canonical account identity (ADR-013), so changing it is a security workflow, not a profile edit. This ADR introduces a reusable **identity verification workflow**, complementing the reusable **authentication primitive** (`sessionVersion`, ADR / issue #132).

## Context

Email is the lookup key for everything: credentials `authorize()` and the Google `jwt` callback both resolve the internal user via `findUnique({ email })`; invitations, eligibility, and post-login routing are all keyed on email. Historically `User.email` had no update path at all — it was written only at registration/provisioning and never mutated.

We want signed-in users to change their own email safely, without weakening the identity model or orphaning in-flight invitations.

## Decision

Model the change as a small state machine rather than an `updateUser()`:

```
beginEmailChange()    -> re-authenticate, mint a single-use token, email the NEW address
confirmEmailChange()  -> the user clicks the link and confirms (POST)
completeEmailChange() -> atomically swap identity + revoke sessions + reconcile invitations
```

### Two independent proofs, no third

1. **Begin** requires authentication **and** the current password. This proves control of the *current* account.
2. **Confirm** requires clicking a tokenized link delivered to the *new* address. This proves control of the *destination* inbox.

These are two independent proofs. We deliberately do **not** prompt for the password a third time at confirmation — the begin step already established that proof, and re-prompting adds ceremony without adding security.

### Eligibility is the ability to re-authenticate, not the provider mix (amended #147)

> Email change eligibility is based on the ability to perform local password re-authentication, not on which authentication providers are linked to the account. Authentication providers determine how a user signs in; password re-authentication is the second proof required for changing account identity.

Concretely, `beginEmailChange` gates on `passwordHash !== null` (returning `password_required` otherwise), never on Google state. A dual account (password + Google) changes its email by re-authenticating with its password; a Google-only account sets a password first — an existing, supported path in Account settings — and then becomes eligible. This replaces the earlier "not Google-linked" rule, which asked *how* a user authenticates rather than *whether they can prove ownership*. The dedicated Google OAuth step-up re-auth once imagined for password-less accounts is unnecessary given the set-a-password path, and is deferred indefinitely.

### Token hashing is an intentional evolution

The verification token is high-entropy (32 random bytes) and is delivered only in the emailed link. We store **only its SHA-256 hash** (`EmailChangeRequest.tokenHash`). This is a deliberate evolution away from the plaintext tokens used by the older invitation tables: those predated this pattern and are capability URLs, whereas an email-change token is takeover-capable. A database leak of hashes cannot be replayed into an account takeover.

Consumption is represented by `consumedAt` meaning "actually confirmed". A superseded request (a newer begin) is **deleted**, not marked — so a missing row unambiguously means "no longer valid" and `consumedAt` never has to carry two meanings. The begin delete+create runs in a **Serializable** transaction so two concurrent begins for the same user can't both leave a pending row (the loser retries once and wins last-begin-wins). This mirrors `betaInvitation`'s one-pending-per-email invariant; a partial unique index is intentionally avoided (unused elsewhere in this codebase and it fights Prisma's schema-drift detection).

### Atomic state transition

Completion is a single atomic transaction: identity update, session revocation, invitation reconciliation, and request consumption either **all** happen or **none** do. A guarded conditional consume (`updateMany where consumedAt: null AND expiresAt > now`, expecting `count === 1`) ensures that when two confirmations race, exactly one wins and the other fails cleanly. The identity write is likewise a guarded `updateMany` (`where id`, expecting `count === 1`) so a user deleted mid-flow rolls the change back cleanly rather than silently no-op'ing. (Before #147 this write was additionally guarded on `googleSubject: null` to close a TOCTOU window where an account became Google-linked mid-flow; since #144 email is no longer identity, so that guard is obsolete and was removed.) Session revocation reuses the `sessionVersion` bump from the credential-change path (ADR / issue #132), so every previously issued session is invalidated and the user signs in again with the new email.

### Invitation reconciliation

An invitation represents "we want this person", not "we want this string forever". On a successful change we re-point **still-pending** `Invitation` and `BetaInvitation` rows from the old email to the new one, reusing the existing pending predicates (unaccepted, uncancelled/unrevoked, unexpired) so the rules don't drift. Accepted invitations are historical (linked by `acceptedByUserId`) and untouched; expired/revoked ones don't matter. Deferring this would create an invisible failure mode ("I verified my new email, so why didn't I get that invitation?").

### Confirm on POST, never GET

The verification link lands on a confirmation page; the change is completed via a POST from that page. Email scanners and link prefetchers routinely issue GET requests, which would otherwise burn a single-use token before the human clicks.

## Non-goals

- **Password-less re-authentication.** A Google-only account (no `passwordHash`) cannot change its email directly, because there is no local second proof to satisfy. Rather than build a bespoke Google OAuth step-up, we rely on the existing "set a password" path: once the account has a password it is eligible like any other. (This supersedes the original v1 non-goal, which refused *all* Google-linked accounts; see the amendment above and #147.)
- **Old-email security notification.** Notifying the previous address that a change occurred is valuable, but it is a distinct delivery path and failure mode that belongs with the broader security-notifications work (#98). This slice stays focused on verification, identity update, and session revocation.

## Future evolution

The Google-resolves-by-`googleSubject` evolution anticipated here landed in #144, and #147 duly extended this workflow to Google-linked accounts **without changing the verification or reconciliation model** — exactly as predicted, the restriction simply became an eligibility check on `passwordHash`.

If invitation ownership later moves from `Invitation.email` to `acceptedByUserId` (or an explicit invitee relation), reconciliation becomes a one-time data migration rather than a permanent runtime feature.

## Consequences

- One new table, `EmailChangeRequest`, and one new domain service, `app/src/lib/emailChange.ts`, following the established action/service boundary: the service owns persistence, validation, transactions, and policy; the action owns auth, request parsing, and email delivery (ADR-014).
- Email-address normalization and format checks are consolidated in a new pure module, `app/src/lib/emailAddress.ts`, so new code shares one definition. (Older ad-hoc validators may converge here later.)
- After a completed change the user is signed out everywhere and must sign in with the new email — the intended, secure outcome for an identity transition.
