# Pull Request Review Checklist

## Purpose

This document defines the standard by which every pull request is reviewed.

The goal of code review is not simply to identify bugs.

A good review ensures that new code:

* Solves the correct problem.
* Fits the existing architecture.
* Improves the product.
* Remains maintainable.
* Preserves long-term quality.

Every pull request should be reviewed against these principles before it is merged.

---

# 1. Product Review

Before reviewing implementation details, verify that the feature solves the correct problem.

Questions:

* Does this solve a validated customer problem?
* Does this align with the Product Vision?
* Does this improve leadership decision-making?
* Is this solving the root problem rather than a symptom?
* Is the feature appropriate for the current stage of the product?

If the answer is "no," implementation details become secondary.

Building the wrong feature correctly is still the wrong outcome.

---

# 2. Domain Review

Verify that responsibilities belong to the correct domain object.

Questions:

* Does this belong to Alliance?
* Does this belong to Member?
* Does this belong to User?
* Does this belong to Metric?
* Does this belong to Leadership Note?

Avoid introducing responsibilities to the wrong object simply because it is convenient.

The domain model should remain clear and intentional.

---

# 3. Architecture Review

Ensure the implementation aligns with the established architecture.

Questions:

* Does this follow existing architectural patterns?
* Does this introduce unnecessary coupling?
* Is this consistent with similar features?
* Does this respect tenant boundaries?
* Is the responsibility located in the correct layer?

Prefer extending existing architecture over introducing new patterns.

---

# 4. Database Review

Review all persistence-related changes.

Questions:

* Are relationships modeled correctly?
* Are foreign keys appropriate?
* Are composite unique constraints needed?
* Is historical data preserved?
* Is calculated data being stored unnecessarily?
* Is the schema still modeling the business domain?

Database decisions are difficult to reverse.

Favor thoughtful design over speed.

---

# 5. Security Review

Security is never optional.

Authentication

* Is the user authenticated?

Authorization

* Does the user have permission?
* Are permissions verified on the server?
* Is tenant isolation maintained?

Remember:

Hidden UI elements are not security.

Every mutation must enforce authorization.

---

# 6. Next.js Review

Review framework usage.

Questions:

* Is this a Server Component by default?
* Is a Client Component actually required?
* Is a Server Action appropriate?
* Is revalidation handled correctly?
* Is unnecessary client-side state being introduced?

Prefer server-first solutions whenever practical.

---

# 7. Prisma Review

Ensure database access follows project conventions.

Questions:

* Are Prisma relations used correctly?
* Are queries efficient?
* Is eager loading appropriate?
* Are transactions required?
* Are cascading behaviors intentional?

Favor expressive Prisma queries over manual data manipulation.

---

# 8. Maintainability Review

Future engineers should be able to understand the implementation quickly.

Questions:

* Is the code easy to read?
* Are names descriptive?
* Can responsibilities be understood at a glance?
* Is there unnecessary complexity?
* Is duplication acceptable or should it be extracted?

Avoid abstractions introduced solely for hypothetical future requirements.

---

# 9. Scope Review

Small pull requests are easier to review, test, and maintain.

Questions:

* Does this PR accomplish a single objective?
* Could it be split into smaller vertical slices?
* Does it include unrelated changes?
* Is every change necessary for this feature?

Large pull requests should be avoided whenever possible.

---

# 10. Future-Proofing Review

Future-proofing should be intentional rather than speculative.

Questions:

* Is the solution configurable?
* Does it support multiple alliances?
* Does it preserve historical information?
* Does it allow future extension without significant refactoring?

Avoid designing for imagined requirements.

Instead, build flexible foundations informed by customer discovery.

---

# Review Order

Pull requests should generally be reviewed in the following order:

1. Product
2. Domain
3. Architecture
4. Security
5. Database
6. Framework Usage
7. Maintainability
8. Scope
9. Performance

Performance optimization should rarely be the first concern.

Correctness and maintainability come first.

---

# What We Optimize For

A successful pull request:

* Solves the correct customer problem.
* Fits naturally within the domain model.
* Preserves architectural consistency.
* Maintains tenant safety.
* Is easy to understand.
* Is easy to review.
* Is easy to extend.
* Can be confidently merged.

---

# What We Avoid

Avoid approving code that introduces:

* Premature abstraction
* Over-engineering
* Unnecessary complexity
* Hidden business logic
* Duplicate architectural patterns
* Tight coupling
* Large, unfocused pull requests

Every pull request should leave the codebase in a better state than it was before.

---

# Guiding Principle

The purpose of code review is not to prove that code works.

It is to ensure that the codebase remains healthy as the product grows.

Every review should improve both the implementation and the shared understanding of the system.
