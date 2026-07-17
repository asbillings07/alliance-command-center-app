# ADR-014: Transactional Email Delivery

## Status

Accepted

## Guiding Principle

> Email is a notification, not a domain capability. The invitation is the source of truth; the email merely tells someone about it. Delivery is a replaceable infrastructure concern that never blocks or invalidates domain work.

## Context

Beta invitations currently generate a shareable link and code that a platform admin copies and forwards manually (Discord, text, etc.). We want the system to email invitees automatically to reduce onboarding friction, while keeping a path toward future transactional emails (password reset, collaborator invitations, reminders).

The existing architecture already separates domain services from infrastructure adapters (see ADR-012, ADR-013). Email should follow the same layering so the provider stays interchangeable and the invitation domain stays pure.

We chose **Resend** as the provider (generous free tier, official SDK, React Email support) and **React Email** for templates (provider-agnostic; only the transport is Resend-specific).

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
deliverEmail()                          (render React Email -> html + text)
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
| Email service | Which business email is this? Builds subject + template. | `email/emailService.ts` |
| Delivery primitive | Render template to html/text, delegate delivery. | `email/deliverEmail.ts` |
| Transport | Deliver a rendered message. | `email/transport/*` |
| Template | How does the email look? | `email/templates/*` |

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
- Templates are provider-agnostic (React Email).

### Trade-offs

- Delivery is synchronous within the request. Acceptable at beta volume.
- No bounce handling, retries, unsubscribe, or analytics yet.

## Future Evolution (not built)

As email volume grows, the natural next step is an outbox:

```text
Action -> Outbox Table -> Background Worker -> Email
```

This would add durability and retries without changing callers (they still call `emailService`). We intentionally do **not** build this before beta.

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
