# ADR-010: Platform Operations Architecture

## Status

Accepted

## Context

The Platform Operations Console replaced the original Platform Dashboard as the primary interface for platform administration. As platform features expand, we need architectural principles to guide development and prevent the platform layer from becoming a monolithic admin tool.

The original dashboard was organized around **database entities**:

```
/platform/alliances
/platform/users
/platform/invitations
```

The redesigned console is organized around **operational questions**:

```
/platform/overview    → "Is beta healthy?"
/platform/setup       → "Who is onboarding?"
/platform/support     → "Help someone"
/platform/activity    → "What happened?"
/platform/beta        → "Manage invitations"
```

This shift from entities to questions is intentional and should guide all future platform development.

## Decision

### Core Principle

> **The Platform Console is an Operations Center, not an Admin Dashboard.**

An admin dashboard edits configuration. An operations console helps humans run the platform.

**Platform pages optimize for operational decisions rather than data management.**

### Architectural Principles

#### 1. Pages answer operational questions, not expose database tables

Every platform page should answer a specific question:

| Page | Question |
|------|----------|
| Overview | Is beta healthy? What needs attention? |
| Setup | Which alliances are onboarding? Who is stuck? |
| Support | Help me investigate this alliance |
| Activity | What happened recently? |
| Beta | Who has been invited? Who accepted? |

If a page doesn't answer a clear operational question, it probably doesn't belong.

#### 2. Platform is a bounded context composed of operational subdomains

Platform services SHOULD be organized by operational subdomain. As subdomains grow, they may evolve from individual modules into dedicated packages containing services, types, and supporting infrastructure.

```
platform/
    activity/      → Live feed, event history
    search/        → Unified search across entities
    support/       → Alliance investigation tools
    beta/          → Invitation management
    onboarding/    → Setup funnel, readiness
```

Each subdomain owns its responsibilities. Subdomains share data through well-defined interfaces, not by reaching into each other's internals.

#### 3. Support pages are the platform's "lens" into alliances

Platform operators should never need alliance membership to investigate an issue.

```
✓ /platform/support/alliance/[id]     → Platform's view into alliance
✗ /alliances/[id]/members              → Tenant UI (requires membership)
```

The support view provides operational context:

- Is onboarding complete?
- Recent activity
- Team composition
- Outstanding invitations
- Alliance timeline

Without pretending to be the alliance UI.

#### 4. Read models over entity CRUD

Platform pages consume **read models** that answer questions, not entity APIs that expose tables.

```
Question → Read Model → UI
```

Not:

```
Database → UI
```

Read models may aggregate data from multiple domain entities in order to answer an operational question. For example, an alliance readiness query combines data from alliances, metrics, periods, and members to answer "Is this alliance ready?"

#### 5. Operational features SHOULD consume a shared event stream

When historical events become a first-class domain concept, operational features should consume from a common event source rather than each feature inventing its own history model:

```
Activity page     → queries events
Alliance timeline → queries events (filtered)
Notifications     → queries events (subscribed)
Audit history     → queries events (all)
```

#### 6. No Platform CRUD

Avoid creating:

```
✗ Platform Members
✗ Platform Metrics
✗ Platform Periods
✗ Platform Imports
```

The platform console answers operational questions. It does not duplicate the tenant UI at a different permission level.

### Authorization Boundary

Platform authorization is completely separate from alliance authorization:

| Context | Authorization | Scope |
|---------|---------------|-------|
| Alliance | `requireAllianceAccess()` | Single alliance, role-based |
| Platform | `requirePlatformAdmin()` | All alliances, admin-only |

These authorization systems are intentionally independent. Platform admins see operational data across all alliances. Alliance members see tenant data within their alliance.

## Non-Goals

The Platform Console is **not** intended to:

- Replace tenant-facing alliance pages
- Provide unrestricted CRUD over every domain entity
- Bypass alliance authorization for data modification
- Duplicate workflows already available within an alliance

## Consequences

### Positive

- **Focused pages** - Each page has a clear purpose and answers a specific question
- **Scalable architecture** - New subdomains (analytics, notifications, audit) slot in naturally
- **Clean authorization** - Platform and alliance concerns remain independent
- **Operational mindset** - The console helps run the product, not just configure it
- **Maintainable services** - Small, focused subdomains instead of one growing service

### Tradeoffs

- **More files** - Subdomain separation creates more service files
- **Discipline required** - Easy to slip into "just add another CRUD page"
- **Read model overhead** - Some queries assemble data from multiple sources

### Future Evolution

As the platform matures, these patterns will likely emerge:

1. **Platform Event Stream** - Formal event model replacing reconstructed activity
2. **Audit History** - Immutable record of all platform events
3. **Notification System** - Consuming the same event stream as activity
4. **Search Providers** - Pluggable search where features register their own results
5. **Platform Analytics** - Operational metrics derived from events

## Design Review Checklist

Every platform PR should satisfy:

- [ ] Page answers a clear operational question
- [ ] Links route to platform support pages, not tenant UI
- [ ] Services organized by subdomain, not utility
- [ ] Read models answer questions, not expose entities
- [ ] No new CRUD patterns introduced
- [ ] Authorization uses `requirePlatformAdmin()` only
- [ ] Activity types are implemented if declared

## Related Documents

- `AGENTS.md` - ADR-002 (multi-tenant), ADR-006 (server-side authorization)
- `docs/adr/007-capability-based-authorization.md` - Alliance authorization
