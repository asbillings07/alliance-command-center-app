# Alliance Command Center - AI Coding Instructions

## Project Philosophy

Alliance Command Center is a leadership and alliance management platform for the game Last War.

Prioritize:

* Simplicity
* Maintainability
* Explicitness
* Domain-driven design

Favor straightforward implementations over clever abstractions.

---

## Architecture Principles

### Authentication vs Authorization

Keep authentication and authorization separate.

Authentication is responsible for:

* Identity verification
* Session creation
* Session retrieval

Authorization is responsible for:

* Alliance access
* Role access
* Permission checks
* Resource access

Do not mix authorization data into authentication sessions.

---

### Session Design

Sessions store identity only.

Use:

```ts
session.user.id
```

Do not store:

* Alliance memberships
* Roles
* Permissions
* Application state

Authorization data should be loaded from the database at request time.

---

### App Routing

The `/app` route is a context-resolution entry point only.

It should:

* Determine user context
* Resolve memberships
* Resolve onboarding state
* Redirect to the appropriate destination

Users should not remain on `/app`.

---

### Alliance Context

Resources should be scoped to alliances whenever possible.

Prefer:

```text
/alliances/[allianceId]/members/[memberId]
```

over:

```text
/members/[memberId]
```

Alliance context should be explicit in routes, queries, and authorization checks.

---

### Security

Always validate:

1. Authentication
2. Alliance access
3. Resource ownership

before loading protected resources.

Use `notFound()` for unauthorized resource access unless a redirect is explicitly required.

---

## Database

Use Prisma as the source of truth.

Prefer:

* `findUnique()` when a unique constraint exists
* `findFirst()` only when uniqueness is not guaranteed

Leverage database constraints whenever possible.

---

## UI Philosophy

Build functionality before styling.

Prioritize:

1. Data flow
2. Validation
3. Authorization
4. User experience
5. Visual polish

Tailwind should remain simple and utility-focused.

Avoid premature component abstraction.

---

## Product Philosophy

Optimize for alliance leaders.

Match terminology used by Last War players.

Examples:

* Use G for billions instead of B
* Display power as 210M instead of 210,000,000

Store data in machine-friendly formats and display data in player-friendly formats.

---

## Development Approach

Implement features incrementally.

Typical workflow:

1. Load data
2. Validate data
3. Render basic UI
4. Add interactions
5. Add styling

Prefer working software over speculative architecture.

Avoid building systems before there is a demonstrated product need.
