# Engineering Constitution

## Purpose

Alliance Command Center exists to help alliance leaders make better leadership decisions through historical, objective, and configurable member intelligence.

This document defines the engineering philosophy that guides the project. It is intentionally stable and should change infrequently. While architecture, technology, and implementation details will evolve over time, the principles outlined here should remain consistent.

When making engineering or product decisions, these principles take precedence over convenience or short-term implementation speed.

---

# Mission

Our mission is to build the operating system for alliance leadership.

Alliance Command Center is not intended to replace the game. It exists to organize, preserve, and surface the information that alliance leaders need in order to make fair, informed, and consistent decisions.

Every feature should ultimately help answer one or more of the following questions:

* Who contributes consistently?
* Who can be trusted?
* Who deserves recognition?
* Who deserves additional responsibility?
* Who is improving?
* Who is declining?

If a feature does not support leadership decision-making, it should be carefully evaluated before becoming part of the product.

---

# Product Philosophy

## Historical Data Over Snapshots

Leadership decisions are rarely made using today's data alone.

Alliance Command Center should prioritize long-term trends over point-in-time information.

Historical data is one of the platform's greatest assets and should never be discarded without careful consideration.

---

## Configuration Over Hardcoding

Every alliance operates differently.

Competitive alliances, casual alliances, and family alliances all value different behaviors.

The platform should provide configurable systems rather than enforcing a single leadership philosophy.

Examples include:

* Configurable metrics
* Configurable weights
* Configurable permissions
* Configurable workflows

Avoid embedding alliance-specific assumptions into the application.

---

## Objective Data Over Memory

Alliance leaders should not need to rely on screenshots, spreadsheets, or memory to justify leadership decisions.

Whenever possible, decisions should be supported by objective, historical information.

---

## Simplicity Over Feature Count

A small number of well-designed features is more valuable than a large number of partially implemented features.

Every feature should solve a validated customer problem.

---

# Engineering Principles

## Model the Domain First

Database design comes before UI design.

The database should model the business domain, not the current user interface.

If the domain is modeled correctly, the UI will emerge naturally.

---

## Vertical Slice Development

Features should be implemented as complete vertical slices.

A vertical slice includes:

* Database changes
* Business logic
* Validation
* Authorization
* User interface

Avoid partially implementing multiple unrelated features.

---

## Small Pull Requests

Pull requests should be:

* Focused
* Reviewable
* Single-purpose

Small pull requests improve quality, reduce risk, and make future maintenance easier.

---

## Readability Over Cleverness

Code is read significantly more often than it is written.

Favor:

* Clear naming
* Straightforward logic
* Explicit behavior

Avoid unnecessary abstraction or clever implementations.

---

## Optimize for Maintainability

The project should remain understandable six months from now.

Every abstraction should have a clear justification.

Premature optimization and speculative architecture should be avoided.

---

# Multi-Tenant First

Alliance Command Center is a SaaS platform.

Every feature should assume:

* Multiple users
* Multiple alliances
* Multiple leadership teams

Avoid assumptions that only work for a single alliance.

Tenant isolation is a fundamental architectural requirement.

---

# Security Principles

Authentication determines who a user is.

Authorization determines what they are allowed to do.

Every mutation must perform server-side authorization checks.

Client-side restrictions are user experience improvements, not security boundaries.

---

# Data Principles

Historical information should be preserved whenever possible.

Calculated values should be derived rather than stored.

The database should remain the source of truth.

Duplicated data should be avoided unless there is a measurable performance benefit.

---

# Technology Philosophy

Prefer Server Components over Client Components.

Prefer Server Actions over unnecessary API routes.

Prefer composition over inheritance.

Prefer existing project patterns over introducing new architectural styles.

Technology choices should support long-term maintainability rather than novelty.

---

# Customer Discovery

Engineering should be guided by customer discovery.

Validated customer problems should drive prioritization.

Interesting ideas that have not been validated should remain future work until supported by research.

The product roadmap should evolve as customer understanding improves.

---

# Artificial Intelligence

AI is treated as an engineering partner rather than a code generator.

AI should:

* Follow existing architecture
* Respect established project patterns
* Prefer consistency over novelty
* Recommend incremental improvements
* Explain architectural tradeoffs

AI should not introduce unnecessary abstractions or rewrite stable code without clear benefit.

---

# Decision Framework

When evaluating new features or architectural decisions, ask:

1. Does this solve a validated customer problem?

2. Does this improve leadership decision-making?

3. Does it support historical data?

4. Is it configurable rather than hardcoded?

5. Is it maintainable?

6. Does it fit the existing architecture?

7. Can it be implemented as a small vertical slice?

If the answer to several of these questions is "no," reconsider the approach.

---

# Long-Term Vision

Alliance Command Center should become the trusted source of truth for alliance leadership.

The platform should reduce subjectivity, improve collaboration, preserve organizational knowledge, and enable alliance leaders to make better decisions through reliable historical data.

Every engineering decision should move the project closer to that vision.
