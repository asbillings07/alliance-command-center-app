# ADR-014: Transactional Email Delivery

## Status

Accepted

## Guiding Principle

> Email is a notification, not a domain capability. The invitation is the source of truth; the email merely tells someone about it. Delivery is a replaceable infrastructure concern that never blocks or invalidates domain work.

## Context

Beta invitations currently generate a shareable link and code that a platform admin copies and forwards manually (Discord, text, etc.). We want the system to email invitees automatically to reduce onboarding friction, while keeping a path toward future transactional emails (password reset, collaborator invitations, reminders).

The existing architecture already separates domain services from infrastructure adapters (see ADR-012, ADR-013). Email should follow the same layering so the provider stays interchangeable and the invitation domain stays pure.

We chose **Resend** as the provider (generous free tier, official SDK). Templates are **hand-rolled HTML + plain text** (inline styles, no template framework); only the transport is Resend-specific. We evaluated React Email but `@react-email/components` is deprecated in favor of the unified `react-email` package, which ships the CLI/preview stack as runtime dependencies. For a small number of simple templates, a hand-rolled builder keeps the dependency footprint minimal (aligned with "avoid unnecessary libraries") while staying fully provider-agnostic.

## Decision

Introduce email as an infrastructure concern behind a small set of boundaries. Nothing in the domain model imports Resend.

### Dependency flow

```text
Platform Action (createInvitationAction / resendInvitationEmailAction)
      |
      v
emailService.sendBetaInvitation()      (business intent)
      |
      v
deliverEmail()                          (non-blocking delivery wrapper)
      |
      v
EmailTransport.deliver()                (boundary)
      |
      v
ResendTransport | LoggingTransport      (adapter)
```

### Layers

| Layer | Responsibility | Location |
|-------|----------------|----------|
| Platform action | Who needs to know? Orchestrates side effects. | `app/platform/beta/actions.ts` |
| Email service | Which business email is this? Builds subject + renders content. | `email/emailService.ts` |
| Delivery primitive | Delegate delivery; guarantee non-blocking (never throws). | `email/deliverEmail.ts` |
| Transport | Deliver a rendered message. | `email/transport/*` |
| Template | How does the email look? Renders html + text. | `email/templates/*` |

### Email after persistence

Invitations are persisted first; the email is sent afterwards from the **platform action layer**, not inside `issueBetaInvitation()`. The domain service answers "what happened?", not "who needs to know?". This keeps the invitation domain free of side effects and avoids the common decay where a domain service accretes email, analytics, Slack, webhooks, and audit logging.

### Non-blocking delivery

Transports never throw for delivery failures. They return a canonical `EmailResult`:

```ts
type EmailStatus = "sent" | "failed" | "skipped";
type EmailResult = { status: EmailStatus; messageId?: string; error?: string };
```

A Resend outage can never invalidate a persisted invitation. The action surfaces the status to the UI (success card notice; resend button feedback) so an admin can retry or share the link manually.

### Message ID

On success we capture Resend's `messageId`. It is unused today but invaluable for future support ("I never got the email") and audit logging.

### Local development and CI

Email is enabled only when **both** `RESEND_API_KEY` and `EMAIL_FROM` are set (`isEmailEnabled()`), mirroring the Google OAuth gate. When unset, `createEmailTransport()` returns a `LoggingTransport` that logs the rendered message and reports `skipped`. Local/CI works with no provider and no real sends. The transport is created once as a module-level singleton.

## Consequences

### Benefits

- Provider is replaceable: swap `ResendTransport` without touching templates, service, or callers.
- Invitation domain stays pure.
- Failures degrade gracefully instead of breaking invitation creation.
- Templates are provider-agnostic and dependency-free (plain HTML + text).

### Trade-offs

- Delivery is synchronous within the request. Acceptable at beta volume.
- No bounce handling, retries, unsubscribe, or analytics yet.

## Future Evolution (not built)

As email volume grows, the natural next step is an outbox:

```text
Action -> Outbox Table -> Background Worker -> Email
```

This would add durability and retries without changing callers (they still call `emailService`). We intentionally do **not** build this before beta.

### Delivery history (#175)

Beta invitation delivery attempts are persisted (`BetaInvitationDeliveryAttempt`) at the same boundary described above — inside `deliverBetaInvitationEmail`/`deliverBetaInvitationEmailWithClaim` (`app/src/lib/betaInvitation.ts`), immediately after the real `EmailResult` is observed. The transport-outcome resolution and the audit-write are two independent `try/catch` blocks: a database failure while persisting a successful send must never be reported to the caller as a failed delivery, and a genuine transport failure must never be silently swallowed by an audit-write problem.

This means a database outage landing in the narrow window between a successful transport call returning and the audit insert completing can produce an **unrecorded** (not mis-recorded) delivery attempt — the same class of gap the outbox design above would close, just for the audit record rather than the send itself. This is an accepted limitation without an outbox; it does not affect the underlying invitation (still the source of truth) or cause any delivery to be duplicated or lost.

**Rollback strategy.** The `BetaInvitationDeliveryAttempt` migration is purely additive — a new table and two new enums, with no `ALTER`/`DROP` of any pre-existing column or table. Per `docs/operations/rollback.md`'s "Option 1: Compensation Migration," rolling it back in production is just a forward-only migration that drops what it added (`DROP TABLE "BetaInvitationDeliveryAttempt"`, then the two enums). Because the audit-write is already isolated behind its own `try/catch` (above), that compensation migration is safe to apply even while application code is still deployed: `recordBetaInvitationDeliveryAttempt` degrades to "unrecorded" rather than breaking invitation delivery. This is validated end-to-end (compensation migration applied, then the forward migration re-applied with every constraint intact) against a disposable isolated database in `betaInvitationDeliveryMigration.integration.test.ts`.

### Access request conversion delivery (#177)

Converting an approved `AccessRequest` into a `BetaInvitation` (`convertAccessRequestToInvitation`, `app/src/lib/accessRequestTriage.ts`) is split the same way persistence and delivery are split everywhere else in this ADR: the Serializable transaction commits the invitation, the `AccessRequestTriage` projection, and the `INVITED` event together — it never calls `deliverBetaInvitationEmail`. The caller (the platform action layer, wired in issue #177's follow-on PR) is responsible for triggering delivery *after* that transaction commits, using the result's disposition to decide whether to:

```ts
{ createdNow: boolean; shouldDeliver: boolean }
```

- `createdNow: true, shouldDeliver: true` — this call just created the invitation; the caller must attempt delivery now.
- `createdNow: false, shouldDeliver: false` — an idempotent re-conversion (retry, double-click, race) of an already-`INVITED` request. It returns the same invitation and existing `INVITED` event untouched. `shouldDeliver: false` means **this call did not (re)trigger delivery** — it does not mean delivery never happened, or that it failed. Re-sending here would violate the same non-duplication expectation `resendInvitationEmailAction` already protects for ordinary resends.

**This introduces a delivery boundary strictly after commit**, alongside the existing post-send/pre-audit-write window documented above under "Delivery history (#175)". Two distinct gaps follow from it, and both must be described to an operator using the established **"Not recorded"** language — never "not sent" or "not yet attempted," since neither can be asserted from what's actually stored:

1. **Pre-transport, deterministic:** `resolveDeliveryActorSnapshot` looks up the acting user *before* any transport call, to snapshot who issued the invitation for the email. If that user no longer exists (e.g. their account was deleted between conversion and delivery), it throws `DeliveryActorUnavailableError` (`app/src/lib/betaInvitationDelivery.ts`) before transport is ever reached. The caller can catch this specifically and report it as "not attempted" — the fact that transport never ran is known with certainty here, unlike the crash window below.
2. **Post-commit, non-deterministic:** the conversion transaction has already committed — the invitation and its `INVITED` event are durable, real history — but the process crashes, is redeployed, or otherwise never reaches the `deliverBetaInvitationEmail` call at all (or that call fails for a reason other than case 1). No `BetaInvitationDeliveryAttempt` row exists, and unlike case 1, it is genuinely *unknown* whether transport ran: report delivery status as unknown and point at the existing **Resend** action rather than silently retrying or silently doing nothing. As with the pre-existing #175 gap, this never invalidates the invitation — the invitation is still the source of truth — and recovery is always an explicit resend, never an inferred one.

Both gaps are accepted for the same reason as the pre-existing #175 window: closing them fully needs an outbox (see "Future Evolution" above), which beta volume does not yet justify. The action layer surfaces a `DeliveryDisposition` distinguishing "attempted" (with the real `EmailStatus`), "not retried — idempotent" (case matching `shouldDeliver: false`), "not attempted" (case 1), and "unknown" (case 2), so the UI never conflates a genuinely idempotent no-op with an unrecorded delivery gap.

### Password reset notifications (follow-on)

Password reset (the request + set-new-password flow) is implemented on top of
this infrastructure via `emailService.sendPasswordReset`. On a successful reset
the domain service also increments the user's `sessionVersion`, so every
previously issued session is revoked (session-version revocation, issue #132) —
a reset immediately logs out any attacker or stale device.

Some related protections are intentionally deferred:

- **Post-reset confirmation email.** After a successful password change, send a
  "your password was changed — if this wasn't you, contact support" notice. This
  is a valuable account-takeover signal and a natural next `emailService`
  method. Tracked as a follow-on issue; not required for beta.
- **Rate limiting + response-timing normalization** for `/forgot-password` and
  `/reset-password`. Bodies are already identical (anti-enumeration), but timing
  can still leak account state, and the endpoints are unauthenticated. A correct
  fix needs shared/edge infrastructure (a per-IP/per-email limiter) and careful
  constant-time handling, best proven with dedicated integration/security tests
  against a disposable Postgres rather than production load tests. Tracked in
  issue #160.

## Configuration

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key. Create at https://resend.com/api-keys |
| `EMAIL_FROM` | Sender address. Use `onboarding@resend.dev` for quick local testing (delivers only to the account owner), or a verified domain address in production. |

## Manual Acceptance Checklist

- Create invitation with email configured -> invitee receives email; success card shows "email sent".
- Create invitation with email unconfigured -> invitation still created; success card shows "not configured".
- Simulated provider failure -> invitation still created; success card shows the warning notice.
- Resend email on a pending invitation -> email re-delivered; no invitation mutation.
- Resend on a non-pending invitation -> rejected with "Only pending invitations can be resent".
