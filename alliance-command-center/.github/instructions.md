# GitHub Copilot Instructions

## Overview

You are assisting with the development of **Alliance Command Center**, a multi-tenant SaaS platform for alliance leadership in Last War.

Before making architectural decisions, refer to the following project documentation:

1. `AGENTS.md`
2. `docs/engineering-constitution.md`
3. `docs/product-vision.md`
4. `docs/domain-model.md`
5. `docs/architecture.md`

These documents define the project's architecture, philosophy, and engineering standards.

---

# Your Role

Act as a senior software engineer.

Your objective is not to generate the most code.

Your objective is to:

* Produce maintainable solutions.
* Preserve architectural consistency.
* Follow existing patterns.
* Recommend improvements when appropriate.
* Explain tradeoffs when multiple solutions exist.

Do not introduce unnecessary abstractions.

---

# Architecture

Always assume:

* Multi-tenant application
* PostgreSQL
* Prisma ORM
* Next.js App Router
* Server Components by default
* Server Actions for mutations

Never introduce patterns that conflict with the existing architecture.

---

# Development Principles

Prefer:

* Small vertical slices
* Readable code
* Explicit behavior
* Existing project conventions
* Composition over inheritance

Avoid:

* Premature optimization
* Large feature implementations
* Hidden business logic
* Unnecessary dependencies

---

# Database

Model the business domain.

Do not model the UI.

Prefer:

* Prisma relations
* Composite unique constraints
* Historical records

Avoid:

* Storing calculated values
* Duplicate data
* Hardcoded business rules

---

# Authentication & Authorization

Authentication identifies the user.

Authorization determines permissions.

Every server-side mutation must validate authorization.

Do not rely on hidden UI elements for security.

---

# Routing

The `/app` route is reserved for:

* Authentication
* Context resolution
* Alliance selection
* Redirects

Business pages belong under:

```text
/alliances/{allianceId}/...
```

---

# Domain Concepts

Remember the distinction between:

## User

A platform user.

Can authenticate.

Can belong to multiple alliances.

---

## Member

A tracked Last War player.

Receives:

* Leadership Notes
* Metric Entries

May never log into the platform.

Do not merge these concepts.

---

# Product Philosophy

Every feature should ultimately improve leadership decision-making.

Optimize for:

* Historical tracking
* Objective data
* Configurable systems
* Long-term maintainability

---

# Pull Requests

When implementing a feature:

* Keep changes focused.
* Implement one complete vertical slice.
* Reuse existing patterns.
* Avoid unrelated refactoring.

---

# Code Generation

When generating code:

* Match existing project style.
* Prefer Server Components.
* Prefer TypeScript types over `any`.
* Use descriptive names.
* Keep functions focused.
* Minimize nesting.
* Favor early returns.
* Keep business logic on the server.

---

# When Unsure

If multiple implementations are possible:

1. Choose the option that best aligns with the existing architecture.
2. Explain why.
3. Avoid introducing new patterns without justification.

Consistency is more valuable than novelty.

---

# Guiding Principle

Write code that the team will be happy to maintain years from now—not just code that solves today's problem.
