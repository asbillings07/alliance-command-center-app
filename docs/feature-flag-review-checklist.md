# Feature Flag Review Checklist

Every pull request that adds or modifies a feature flag must satisfy these
criteria, in addition to the general [Pull Request Review Checklist](./engineering-review-philosophy.md).
This turns [ADR-019](./adr/019-feature-flag-targeting-lifecycle-contract.md)'s
contract and [docs/operations/feature-flags.md](./operations/feature-flags.md)'s
governance into an objective review, the same way
[design-review-checklist.md](./design-review-checklist.md) does for UI PRs.

This checklist is for PRs that **introduce or change** a flag. A PR that
**removes** a flag (working its removal issue) follows
[feature-flags.md §6](./operations/feature-flags.md#6-retirement-workflow)
instead.

## Registry

- [ ] **Complete registry entry** - `key`, `description`, `category`,
      `owner`, `issue`, `productionDefault`, `targetingStrategy`,
      `expiresOn` are all set in `app/src/lib/featureFlags/registry.ts`.
- [ ] **Description states the disable consequence** - the free-text
      `description` says what "off" looks like for this flag (e.g. "ships
      dark, both routes 404"), not just what "on" adds. This is the
      registry's home for "rollback consequence" - there is no separate
      field for it.
- [ ] **`productionDefault` is `false`** for a `temporary-release` flag
      (never today's target live value - that's Vercel dashboard
      configuration, not the registry) or the documented safe posture for an
      `operational-kill-switch` (ADR-019 §4).

## Lifecycle

- [ ] **Removal issue opened in this same PR** - not deferred to "before
      broad enablement" or to deletion time (ADR-019 §8's "from day one"
      rule). Link it as the registry entry's `removalIssue`.
- [ ] **`docs/operations/feature-flags.md` §1 inventory table updated** with
      the new row.

## Tests

- [ ] **On/off tests at the page/route boundary** - both the enabled and
      disabled path are covered, not just one.
- [ ] **Direct-route and mutation/API coverage for the disabled state** -
      per [ADR-019 §5](./adr/019-feature-flag-targeting-lifecycle-contract.md#5-disabled-behavior-is-explicit-per-surface),
      confirm the *specific* disabled behavior for this surface
      (`notFound()`, stable old experience, typed unavailable result, etc.),
      not just that "something" happens.
- [ ] **Wrong-context cases are covered for targeted flags** - an
      `alliance-targeted` or `operator-only` flag has a test for an
      untargeted alliance/non-operator being denied regardless of the
      flag's global state.

## Rollout readiness

- [ ] **Vercel flag created, Production default matches the registry** -
      before merge, or immediately after and before the PR is considered
      done. `vercel flags inspect <key>` confirms Production/Preview/
      Development state.
- [ ] **Feature-specific success/error signal is stated on the flag's
      issue** - before any real cohort is targeted (see
      [feature-flags.md §4](./operations/feature-flags.md#4-observability)),
      not merely "we'll know if it breaks."
- [ ] **Changelog timing matches actual enablement, not merge** - if this
      change is user-facing, [docs/changelog.md](./changelog.md) is updated
      when the flag is actually enabled for the relevant audience, never
      speculatively at merge time (the lesson from #329's post-release QA
      gate).

## Authorization (restated, not new)

- [ ] **The flag never substitutes for authorization** - every protected
      route/action/job this flag touches still calls its normal
      authorization check regardless of flag state (ADR-019 §6). An enabled
      flag never bypasses `requireAllianceAccess` or an equivalent check.
