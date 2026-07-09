# Architecture

## Overview

Alliance Command Center is a multi-tenant SaaS application built using modern web technologies. The architecture prioritizes maintainability, scalability, and clear separation of responsibilities.

The application follows a domain-driven approach where the database models represent the business concepts of alliance leadership rather than the user interface.

---

# Technology Stack

## Frontend

* Next.js (App Router)
* React
* TypeScript
* Tailwind CSS

## Backend

* Next.js Server Components
* Next.js Server Actions

## Database

* PostgreSQL

## ORM

* Prisma

## Authentication

* Auth.js (NextAuth)

## Development

* Docker
* GitHub
* Prisma Studio

---

# High-Level Architecture

```text
Browser
    │
    ▼
Next.js Application
    │
    ├── Server Components
    ├── Client Components
    ├── Server Actions
    │
    ▼
Prisma ORM
    │
    ▼
PostgreSQL
```

---

# Multi-Tenant Architecture

Alliance Command Center is designed as a multi-tenant SaaS.

A single deployment supports multiple alliances while ensuring complete data isolation between tenants.

Core relationships:

```text
User
    │
    ▼
AllianceMembership
    │
    ▼
Alliance
```

Users may belong to multiple alliances.

Every feature must respect tenant boundaries.

---

# Routing Philosophy

The `/app` route is **not** an application page.

Its responsibility is to:

* Verify authentication
* Resolve user context
* Determine active alliance
* Redirect users to the correct destination

Business features should live beneath alliance-specific routes.

Example:

```text
/alliances/{allianceId}
/alliances/{allianceId}/members
/alliances/{allianceId}/members/{memberId}
```

This keeps all business operations scoped to an alliance.

---

# Authentication

Authentication answers:

> Who is this user?

Authentication is handled through Auth.js.

Authenticated users are represented by the `User` model.

---

# Authorization

Authorization answers:

> What is this user allowed to do?

Permissions are determined through `AllianceMembership`.

Example roles:

* OWNER
* ADMIN
* LEADER
* VIEWER

Every mutation must perform authorization checks on the server.

UI visibility is not considered authorization.

---

# Current Domain Model

Current business entities include:

```text
Alliance
│
├── Members
│   ├── Leadership Notes
│   └── Member Metric Entries
│
├── Metrics
│
└── Alliance Memberships
    └── Users
```

---

# Database Design Principles

The database models the business domain.

Relationships should reflect real-world concepts.

Examples:

* A Member belongs to an Alliance.
* A Leadership Note belongs to a Member.
* A Metric belongs to an Alliance.
* A MemberMetricEntry records a historical score.

Calculated values should not be persisted unless required for performance.

Historical records should be preserved whenever possible.

---

# Server Components

Server Components are the default rendering strategy.

Responsibilities include:

* Data loading
* Database access
* Authorization checks
* Initial page rendering

Client Components should only be introduced when browser interactivity is required.

---

# Server Actions

Mutations should be implemented using Server Actions.

Typical workflow:

1. Authenticate user.
2. Authorize request.
3. Validate input.
4. Perform database operation.
5. Revalidate affected pages.
6. Return result.

Business logic should remain on the server whenever possible.

---

# Prisma

Prisma serves as the application's data access layer.

Guidelines:

* Prefer relations over manual joins.
* Use explicit relation names.
* Use composite unique constraints where appropriate.
* Keep schema aligned with the business domain.
* Avoid storing calculated values.

---

# Current Project Structure

```text
app/
components/
lib/
prisma/
docs/
public/
```

As the application grows, organization should continue to emphasize domain boundaries over technical layers.

---

# Current Development Workflow

Every feature follows a consistent workflow:

1. Customer discovery
2. Product discussion
3. GitHub issue
4. Database design
5. Vertical slice implementation
6. Pull request
7. Code review
8. Merge
9. Refactor (only if necessary)

This workflow prioritizes learning, maintainability, and incremental delivery.

---

# Future Architectural Goals

As Alliance Command Center grows, the architecture should continue to emphasize:

* Clear domain boundaries
* Small, reviewable changes
* Multi-tenant scalability
* Historical data preservation
* Configurable systems
* Strong authorization
* Maintainability over complexity

Technology choices may evolve over time, but these architectural goals should remain consistent.
