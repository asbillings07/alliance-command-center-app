# Testing Strategy

This document defines the testing philosophy, principles, and practices for Alliance Command Center.

---

# Engineering Lifecycle

This is how software gets built at Alliance Command Center:

```
Customer Discovery
        ↓
  GitHub Issue
        ↓
Product Discussion
        ↓
  Domain Model
        ↓
  Architecture
        ↓
 Implementation
        ↓
   Unit Tests
        ↓
Integration Tests
        ↓
    E2E Tests
        ↓
 Quality Gates
        ↓
Engineering Review
        ↓
     Merge
        ↓
   Production
        ↓
Customer Feedback
```

Testing is not an afterthought. It's part of the lifecycle.

---

# Testing Principles

Tests exist to verify product behavior, not implementation details.

* Prefer testing **user outcomes** over internal implementation.
* Prefer **business rules** over UI structure.
* Prefer **stable selectors** over CSS selectors.
* Avoid brittle tests.
* Tests should reflect the **domain model**.
* The most important workflows receive the strongest test coverage.
* The test suite should give the team **confidence to refactor without fear**.

---

# Test Levels

Not everything belongs in E2E tests. Choose the right level:

```
Unit Tests
    ↓
Integration Tests
    ↓
E2E Tests
```

| Test Type | Purpose | Example |
|-----------|---------|---------|
| **Unit** | Verify isolated business logic | Weighted score calculation |
| **Integration** | Verify interaction between services | Server Action + Prisma |
| **E2E** | Verify complete user workflow | Leader records member metrics |

## What NOT to Test with E2E

Do not write E2E tests for:

* Pure calculations
* Utility functions
* Formatting helpers
* Validation helpers
* Prisma model behavior
* Individual React components

These belong in unit or integration tests.

E2E tests verify **user journeys**, not implementation details.

---

# Coverage Philosophy

Coverage is a tool, not a goal.

We optimize for **confidence** rather than coverage percentages.

The most valuable business workflows should receive the strongest test coverage.

---

# ADR Alignment

Tests enforce the Architectural Decision Records from AGENTS.md:

| ADR | Principle | Test Coverage |
|-----|-----------|---------------|
| **ADR-002** | Multi-tenant - every feature respects tenant boundaries | `tenant-isolation.spec.ts` |
| **ADR-003** | Weighted scores are calculated, never persisted | `metric-business-rules.spec.ts` |
| **ADR-004** | Historical records (notes, entries) are preserved | `member-business-rules.spec.ts`, `note-business-rules.spec.ts` |
| **ADR-005** | Users ≠ AllianceMembers (different concepts) | Domain model separation in all tests |
| **ADR-006** | Authorization enforced server-side | `permission-matrix.spec.ts` |

---

# Stable Selectors

Always prefer:

```ts
// Good - data-testid
page.getByTestId('save-member-button')

// Good - accessible roles
page.getByRole('button', { name: 'Save Member' })

// Good - labels
page.getByLabel('Player Name')
```

Avoid:

```ts
// Bad - CSS selectors
page.locator('.btn-primary')

// Bad - nth-child
page.locator('tr:nth-child(3)')

// Bad - text that changes
page.locator('text=Save')
```

Add `data-testid` attributes to interactive elements:

```tsx
<Button data-testid="save-member">Save Member</Button>
```

---

# Test Naming Convention

## File Names

Use descriptive, domain-aligned names:

```
member-crud.spec.ts           // Good
member-search-filter.spec.ts
note-permissions.spec.ts

works.spec.ts                 // Bad
test1.spec.ts
```

## Test Names

Describe the behavior from the user's perspective:

```ts
// Good - describes who, what, outcome
test('Owner can archive an Alliance Member')
test('Viewer cannot create Leadership Notes')
test('Archived members retain historical metric entries')

// Bad - vague or implementation-focused
test('archives member')
test('test archive')
test('it works')
```

---

# Test Organization

Tests are organized to mirror the domain model:

```
e2e/
  auth/
    login.spec.ts
    registration.spec.ts
    beta-redemption.spec.ts
    alliance-invitation.spec.ts
  
  alliance/
    create-alliance.spec.ts
    setup-flow.spec.ts
  
  alliance-members/
    member-crud.spec.ts
    member-business-rules.spec.ts
  
  leadership-notes/
    note-crud.spec.ts
    note-permissions.spec.ts
  
  metrics/
    metric-crud.spec.ts
    period-crud.spec.ts
  
  authorization/
    permission-matrix.spec.ts
    tenant-isolation.spec.ts
  
  design-system/
    visual-regression.spec.ts
  
  shared/
    fixtures.ts
    accessibility.ts
```

---

# Beta Release Gates

These tests **must be green before beta ships**. If any fail, we don't ship.

* Authentication
* Alliance Setup
* Alliance Member Management
* Leadership Notes
* Metrics and Recording
* Dashboard

---

# Continuous Integration

## Philosophy

Every pull request should provide confidence that the application remains stable.

Testing should be automatic.

Developers should not need to remember to execute tests before opening a pull request.

Continuous Integration is responsible for verifying that every change meets the project's quality standards.

A pull request is considered merge-ready only when all required quality gates pass.

---

# Required Quality Gates

Every Pull Request must successfully complete the following checks.

## Code Quality

* ESLint
* TypeScript type checking
* Prettier formatting (if enabled)

---

## Unit Tests

Execute all unit tests.

Purpose:

Verify individual business logic.

---

## Integration Tests

Execute integration tests.

Purpose:

Verify interactions between application layers.

Examples:

* Prisma
* Server Actions
* Authentication
* Authorization

---

## End-to-End Tests

Execute Playwright E2E tests.

The Beta Release Gates must always pass.

These tests verify the application's critical user journeys.

---

## Accessibility

Run automated accessibility validation.

Examples:

* axe-core

Accessibility regressions should block merges.

---

## Visual Regression

Run Playwright screenshot comparisons for critical pages.

Examples:

* Dashboard
* Members
* Member Detail
* Leadership Notes
* Metrics

Unexpected visual changes require review before merging.

### Updating Visual Regression Baselines

When an intentional UI change alters screenshot snapshots, CI will fail because screenshots rendered on Linux (`*-application-linux.png`) differ from saved baselines. Playwright maintains separate snapshot baselines for **macOS (`*-darwin.png`)** and **Linux (`*-linux.png`)** due to font-rendering and subpixel antialiasing differences across operating systems.

To update visual baselines when UI changes are intentional:

#### 1. Local macOS Baseline Update
To update local macOS snapshots (`*-darwin.png`):

```bash
# Update local macOS visual baselines
npm run test:visual -- --update-snapshots
```

#### 2. Linux CI Baseline Update (The Runbook)
GitHub Actions CI runs on Linux (`ubuntu-latest`) and compares against `*-application-linux.png` snapshots. Never manually edit or forge Linux PNG files locally.

1. **Push your UI changes** to your feature branch:
   ```bash
   git push origin <your-branch>
   ```

2. **Trigger the Linux baselines workflow** via GitHub CLI or the GitHub Actions tab:
   ```bash
   gh workflow run visual-baselines.yml --ref <your-branch>
   ```

3. **Download the generated Linux baselines** once the workflow completes:
   ```bash
   # Find the run ID (e.g. gh run list --workflow=visual-baselines.yml)
   gh run download <run-id>
   ```

4. **Copy the updated Linux snapshots** into the snapshot directory:
   ```bash
   cp -r visual-baselines-linux/e2e/design-system/visual-regression.spec.ts-snapshots/* e2e/design-system/visual-regression.spec.ts-snapshots/
   rm -rf visual-baselines-linux
   ```

5. **Commit and push** the updated `*-application-linux.png` baseline files to your PR branch:
   ```bash
   git add e2e/design-system/visual-regression.spec.ts-snapshots/*-application-linux.png
   git commit -m "test(visual): update Linux visual regression baselines"
   git push origin <your-branch>
   ```

---

# Quality Gates

Every Pull Request must pass the project's Quality Gates before merge.

The current implementation of these gates is GitHub Actions.

| Quality Gate | Status |
|--------------|--------|
| Build | Required |
| Type Check | Required |
| ESLint | Required |
| Unit Tests | Required |
| Integration Tests | Required |
| Playwright Release Gates | Required |
| Accessibility | Required |
| Visual Regression | Required |

All Quality Gates must pass before merging into `main`.

Quality Gates are a philosophy, not an implementation detail. The specific CI tool may change over time, but the gates remain constant.

---

# Build Verification

Every Pull Request must successfully build the production application.

Example:

npm run build

Compilation failures should prevent merging.

---

# Branch Protection

The main branch should enforce:

* Required status checks
* Passing CI
* At least one approved review
* No failing conversations
* Up-to-date branch before merge

Direct commits to main should be disabled.

---

# Pull Request Workflow

Developer

↓

Push Branch

↓

GitHub Actions

↓

Quality Gates

↓

Engineering Review

↓

Merge

---

# Test Failures

A failing test represents one of three possibilities:

1. A defect has been introduced.
2. The product behavior has intentionally changed.
3. The test is incorrect.

Tests should never be disabled simply to allow a merge.

Failures should be investigated and resolved before merging.

---

# CI Philosophy

The purpose of CI is confidence.

Every successful pipeline should increase confidence that the application remains:

* Correct
* Stable
* Accessible
* Maintainable
* Deployable

Automation should remove uncertainty from the release process.

---

# Parallelization Strategy

Playwright tests run in parallel for speed:

```
Independent Suites
      ↓
Run in Parallel
      ↓
Shared Fixtures
      ↓
Independent Test Data
      ↓
Aggregate Results
```

Test suites should be independent. No test should depend on another test's state.

---

# Flaky Test Policy

Flaky tests are defects. They should never be ignored.

If a test becomes flaky:

1. **Investigate** - Find the root cause
2. **Fix** - Resolve the underlying issue
3. **Quarantine** - Only temporarily, if absolutely necessary

Never normalize intermittent failures. A flaky test erodes trust in the entire suite.

---

# Guiding Principle

A feature is not complete until it is automatically verified.

If the team cannot confidently merge a change because it lacks automated validation, the implementation is incomplete.

---

# Continuous Improvement

Every production bug should result in one of the following:

1. A new automated test
2. An improvement to an existing automated test

The test suite should continuously become stronger as the application evolves.

The goal is not to eliminate bugs.

**The goal is to ensure the same bug never happens twice.**
