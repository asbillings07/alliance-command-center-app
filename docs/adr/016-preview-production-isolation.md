# ADR-016: Preview / Production Isolation

## Status

Accepted (2026-07, #153). Enforcement is fail-closed in the application; the corresponding Vercel + Neon + Resend configuration is an operator responsibility documented below.

## Guiding Principle

> A Preview deployment must never read or mutate production data, and must never send live email to real users.

Previews exist to review unmerged code. Treating them as harmless is the mistake: a preview build runs code that has not passed review, and if it shares the production database or an unrestricted email sender, that unreviewed code can corrupt real alliance data or deliver real security links (invitations, password-reset, email-change) to real people.

## Context

Before this ADR the repository could not *prove* isolation:

- `isEmailEnabled()` only checks whether Resend credentials exist; it does not distinguish Preview from Production, so a preview that inherited the production Resend key would send live mail.
- Nothing verified that `DATABASE_URL` on a Preview deploy pointed at a non-production database. A raw hostname comparison is also unreliable with Neon, where the same branch is reachable through a pooled host (`ep-x-123-pooler...`) and a direct host (`ep-x-123...`).

We are about to invite real users and store real alliance data, so this is the moment to establish the boundary rather than accept "shared temporarily."

## Decision

Two application-level, fail-closed guards, backed by operator configuration.

### 1. Database identity guard

A shared resolver ([`app/src/lib/productionDb.ts`](../../app/src/lib/productionDb.ts)) reduces any connection string to a stable **Neon endpoint identity** — the `ep-...` label with the `-pooler` suffix stripped — so pooled and direct forms collapse to the same value. This extraction is scoped to verified `*.neon.tech` hosts only; any other host (including a lookalike such as `ep-prod-123.example.com`) keeps its exact hostname as its identity, so it can never collide with a real Neon endpoint id.

`PRODUCTION_DB_HOSTS` is an explicit allowlist of production identities and is **required on Vercel**. At startup (`validateEnv()` via `instrumentation.ts`) every DB connection string that can touch data (`DATABASE_URL`, and `DIRECT_URL` when present) is checked:

- **Vercel Production**: every connection MUST resolve to a listed production identity.
- **Vercel Preview**: NO connection may — a preview pointing at production aborts startup.
- **Local / CI / test** (`VERCEL_ENV` unset): unconstrained.

The same resolver is reused by the beta cleanup tooling (ADR follow-up) so the app and the operator scripts can never disagree about "which database is production."

### 2. Preview email gate

The transport factory ([`app/src/lib/email/transport/index.ts`](../../app/src/lib/email/transport/index.ts)) defaults a Preview deployment to the logging no-op even when a Resend key is present. Preview sends real mail only when `PREVIEW_EMAIL_ALLOWLIST` explicitly names testers, and then only through `AllowlistTransport`, which delivers to a message **only if every envelope recipient is on the allowlist** (parsing all comma-separated addresses; today the envelope is the `to` field, with no cc/bcc). Any off-list recipient means the whole send is skipped — never partially delivered.

Logging is metadata-only: `LoggingTransport` already redacts the body in production (and Vercel sets `NODE_ENV=production` on Preview, so preview logs carry no tokens/links), and `AllowlistTransport` logs only subject + counts + metadata when it skips.

## Consequences

- Isolation is provable and enforced at boot, not assumed. A misconfigured Preview fails loudly instead of silently touching production.
- Operators must configure, per Vercel environment:
  - a **separate Neon database/branch** for Preview, with Preview's `DATABASE_URL`/`DIRECT_URL` scoped to it;
  - `PRODUCTION_DB_HOSTS` set to the production endpoint identity in both environments;
  - `PREVIEW_EMAIL_ALLOWLIST` (Preview only) and, as defense in depth, a **separate Preview Resend credential**;
  - a separate Preview `AUTH_SECRET` (unless a future OAuth redirect-proxy design specifically requires sharing).
- #153 is closed once the above configuration is applied and verified in both environments; the application guards ship with this ADR.
