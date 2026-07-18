# AGENTS.md

## Alliance Command Center - AI Engineering Guide

Welcome to the Alliance Command Center project.

This repository is designed to be developed collaboratively by humans and AI assistants. Before making architectural decisions, implementing features, or reviewing code, read this document completely.

This file serves as the entry point into the project's engineering philosophy.

---

## Required Reading

Before making significant changes, read these documents in order:

1. `docs/engineering-constitution.md`
2. `docs/product-vision.md`
3. `docs/domain-model.md`
4. `docs/architecture.md`
5. `docs/engineering-review-philosophy.md`
6. `docs/design-principles.md`
7. `docs/color-design-principles.md`
8. `docs/testing-strategy.md`

These documents define the philosophy, architecture, and engineering standards of the project.

Implementation should align with these documents unless an architectural decision has been intentionally changed.

---

## Project Summary

Alliance Command Center is a multi-tenant SaaS application built for alliance leadership in Last War.

The platform is not intended to replace the game.

Its purpose is to help alliance leaders make better leadership decisions by combining historical participation data, configurable metrics, and qualitative leadership observations into a single source of truth.

The application should become the operating system for alliance leadership.

---

## Your Role

Act as a senior software engineer on the project.

Do not optimize for generating the most code.

Optimize for:

* Correct architecture
* Maintainability
* Consistency
* Simplicity
* Product value

When appropriate, explain tradeoffs and recommend better approaches.

Do not blindly agree with implementation ideas if they violate established project principles.

---

## Product Philosophy

Every feature should ultimately help answer one or more of these questions:

* Who contributes consistently?
* Who can be trusted?
* Who deserves promotion?
* Who deserves additional responsibility?
* Who is improving?
* Who is declining?

If a proposed feature does not improve leadership decision-making, challenge whether it belongs in the product.

---

## Development Workflow

Every feature should follow this workflow:

Customer Discovery

↓

GitHub Issue

↓

Domain Discussion

↓

Database Design

↓

Architecture Discussion

↓

Implementation

↓

Pull Request

↓

Engineering Review

↓

Merge

Avoid skipping steps.

The project intentionally prioritizes learning and architecture before implementation.

---

## Engineering Principles

Always prefer:

* Historical data over snapshots
* Configuration over hardcoded rules
* Small vertical slices over large feature branches
* Readability over cleverness
* Maintainability over short-term speed
* Existing patterns over introducing new architecture

Avoid:

* Premature abstraction
* Unnecessary libraries
* Hidden business logic
* Over-engineering
* Speculative features
* Large pull requests

---

## Architectural Decision Records

These decisions are foundational unless intentionally changed.

## ADR-001

`/app` exists only for authentication, context resolution, and routing.

Business pages belong under:

```
/alliances/{allianceId}/...
```

---

## ADR-002

Alliance Command Center is multi-tenant.

Every feature must respect tenant boundaries.

Never assume a single alliance.

---

## ADR-003

Weighted scores are calculated.

They are never persisted.

Historical data is the source of truth.

---

## ADR-004

Historical records are preserved.

Leadership Notes and Member Metric Entries represent organizational history and should generally not be overwritten or deleted.

---

## ADR-005

Users and AllianceMembers are intentionally different concepts.

User

* Authenticates
* Performs actions

AllianceMember

* Is the alliance's record about a tracked player
* Is evaluated
* Receives leadership notes
* Receives metric entries

Do not combine these concepts.

---

## ADR-006

Authorization is always enforced on the server.

Hidden UI elements do not provide security.

Every mutation must verify permissions.

---

## ADR-010

The Platform Console is an Operations Center, not an Admin Dashboard.

Platform pages answer operational questions:

* Overview → Is beta healthy?
* Setup → Who is onboarding?
* Support → Help me investigate
* Activity → What happened?

Platform services are organized by domain (activity, search, support, beta).

Support pages are the platform's "lens" into alliances—operators never need alliance membership to investigate.

See `docs/adr/010-platform-operations-architecture.md` for full details.

---

## ADR-013

OAuth providers are authentication only.

Google proves a user owns a verified email. Authorization and account eligibility remain governed by the invitation model and verified email identity.

* No Prisma adapter; email stays the canonical identity.
* Authentication is modeled as capabilities, not a provider enum: `User.passwordHash` present enables password login, `User.googleSubject` present enables Google login. A user may have both (e.g. the operator's break-glass account).
* Google's subject (`sub`) is the security anchor: linked on first Google sign-in, asserted thereafter; a mismatch is denied.
* Every JWT `sub` is always the internal `User.id`, regardless of provider.

See `docs/adr/013-google-oauth.md` for full details.

---

## ADR-014

Email is a notification, not a domain capability.

Transactional email is a replaceable infrastructure concern. The invitation is the source of truth; the email merely announces it.

* Email is sent from the platform action layer, after persistence, never inside domain services.
* Delivery is non-blocking: transports return an `EmailResult` (`sent` | `failed` | `skipped`) and never throw, so a provider outage cannot invalidate an invitation.
* Nothing outside `app/src/lib/email/` imports Resend; the provider lives behind `EmailTransport` (`ResendTransport` in prod, `LoggingTransport` locally).
* Templates are hand-rolled HTML + plain text (no template framework), keeping the dependency footprint minimal.

See `docs/adr/014-transactional-email.md` for full details.

---

## Database Philosophy

Model the business domain.

Do not model the user interface.

Ask:

* Which domain object owns this responsibility?
* Is this historical data?
* Is this configuration?
* Is this calculated data?

Historical information should be stored.

Calculated information should generally be derived.

---

## UI Philosophy

The UI exists to support leadership workflows.

Prioritize:

* Clarity
* Speed
* Simplicity

Avoid building dashboards that provide little decision-making value.

Member Detail pages should remain the primary surface for leadership information.

---

## Next.js Philosophy

Prefer:

* Server Components
* Server Actions
* Server-side authorization
* Server-side data loading

Use Client Components only when browser interactivity requires them.

---

## Prisma Philosophy

Use Prisma to model business relationships.

Prefer:

* Relations
* Explicit ownership
* Composite unique constraints

Avoid:

* Duplicated calculated data
* Manual joins when relations are appropriate

---

## Pull Requests

Every pull request should represent a complete vertical slice.

Examples:

✓ Leadership Note CRUD

✓ Metric CRUD

✓ Member Detail Page

Avoid combining unrelated work.

Small pull requests are easier to review, test, and maintain.

---

## Code Reviews

Review changes in this order:

1. Product
2. Domain
3. Architecture
4. Security
5. Database
6. Framework Usage
7. Maintainability
8. Scope
9. Performance

Performance optimization should rarely be the primary concern.

Correctness and maintainability come first.

---

## Challenge Assumptions

Do not assume the proposed solution is the best solution.

If a simpler, more maintainable, or more consistent approach exists:

* Explain it.
* Recommend it.
* Discuss tradeoffs.

Healthy technical disagreement is encouraged.

---

## Long-Term Thinking

Write code as if the project will be maintained for many years.

Prefer solutions that improve the health of the codebase rather than merely completing the current task.

The goal is not simply to build software.

The goal is to build a product and an engineering culture that can scale.

---

## Guiding Principle

Every decision should move Alliance Command Center closer to becoming the trusted source of truth for alliance leadership.

When multiple valid solutions exist, choose the one that best aligns with the project's architecture, philosophy, and long-term vision—not necessarily the one requiring the fewest lines of code.
