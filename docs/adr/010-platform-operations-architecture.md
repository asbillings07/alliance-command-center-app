# ADR-010: Platform Operations Architecture

## Status

Accepted

## Context

PR #78 introduced the Platform Operations Console, replacing the original Platform Dashboard. As the platform features expand, we need architectural principles to guide development and prevent the platform layer from becoming a monolithic admin tool.

The original dashboard was organized around **database entities**:

```
/platform/alliances
/platform/users
/platform/invitations
```

The new console is organized around **operational questions**:

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

#### 2. Platform is a bounded context with distinct domains

Platform services are organized by operational domain, not by utility:

```
platform/
    activity/      → Live feed, event history
    search/        → Unified search across entities
    support/       → Alliance investigation tools
    beta/          → Invitation management
    onboarding/    → Setup funnel, readiness
```

Each domain owns its responsibilities. Domains share data through well-defined interfaces, not by reaching into each other's internals.

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

For example, `getAllianceReadiness()` returns a read model that combines data from alliances, metrics, periods, and members to answer "Is this alliance ready?"

#### 5. Features consume shared event streams

Instead of each feature inventing its own history model:

```
Activity page     → queries events
Alliance timeline → queries events (filtered)
Notifications     → queries events (subscribed)
Audit history     → queries events (all)
```

All operational features should consume from a common event source (see: Platform Event Stream issue).

#### 6. No Platform CRUD

Avoid creating:

```
✗ Platform Members
✗ Platform Metrics
✗ Platform Periods
✗ Platform Imports
```

The platform console answers operational questions. It does not duplicate the tenant UI at a different permission level.

### Service Organization

Current structure:

```
app/src/lib/platform/
    alliances.ts    → Alliance queries for platform views
    invitations.ts  → Beta and collaborator invitation queries
    activity.ts     → Live feed event assembly
    setup.ts        → Onboarding funnel and readiness
    attention.ts    → Action required items
    search.ts       → Unified platform search
```

Future evolution (as domains grow):

```
app/src/lib/platform/
    activity/
        service.ts
        types.ts
    search/
        service.ts
        providers.ts
        types.ts
    support/
        service.ts
        types.ts
    beta/
        service.ts
        types.ts
    onboarding/
        service.ts
        types.ts
```

### Authorization Boundary

Platform authorization is completely separate from alliance authorization:

| Context | Authorization | Scope |
|---------|---------------|-------|
| Alliance | `requireAllianceAccess()` | Single alliance, role-based |
| Platform | `requirePlatformAdmin()` | All alliances, admin-only |

These never overlap. Platform admins see operational data across all alliances. Alliance members see tenant data within their alliance.

## Consequences

### Positive

- **Focused pages** - Each page has a clear purpose and answers a specific question
- **Scalable architecture** - New domains (analytics, notifications, audit) slot in naturally
- **Clean authorization** - Platform and alliance concerns never mix
- **Operational mindset** - The console helps run the product, not just configure it
- **Maintainable services** - Small, focused domains instead of one growing platform.ts

### Tradeoffs

- **More files** - Domain separation creates more service files
- **Discipline required** - Easy to slip into "just add another CRUD page"
- **Read model overhead** - Some queries assemble data from multiple sources

### Future Evolution

As the platform matures, these patterns will likely emerge:

1. **Platform Event Stream** - Formal event model replacing reconstructed activity
2. **Search Providers** - Pluggable search where features register their own results
3. **Notification System** - Consuming the same event stream as activity
4. **Audit History** - Immutable record of all platform events
5. **Platform Analytics** - Operational metrics derived from events

## Design Review Checklist

Every platform PR should satisfy:

- [ ] Page answers a clear operational question
- [ ] Links route to platform support pages, not tenant UI
- [ ] Services organized by domain, not utility
- [ ] Read models answer questions, not expose entities
- [ ] No new CRUD patterns introduced
- [ ] Authorization uses `requirePlatformAdmin()` only
- [ ] Activity types are implemented if declared

## Related Documents

- `AGENTS.md` - ADR-002 (multi-tenant), ADR-006 (server-side authorization)
- `docs/adr/007-capability-based-authorization.md` - Alliance authorization
- GitHub Issue: Platform Event Stream
