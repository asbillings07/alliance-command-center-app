# Feature Flag Rollout Governance

Operational contract for how ACC enables, observes, disables, and retires a
feature flag - built on top of the architecture [ADR-019](../adr/019-feature-flag-targeting-lifecycle-contract.md)
already fixed. That ADR defines what a flag *means* (categories, trust
boundary, evaluation/failure semantics, registry shape); this doc defines the
*process* around using one safely (#333). It does not amend ADR-019, which
remains a frozen, accepted historical record.

The registry ([`app/src/lib/featureFlags/registry.ts`](../../app/src/lib/featureFlags/registry.ts))
is the single compiler-enforced source of truth for every flag's static
metadata. Nothing in this document duplicates it or duplicates Vercel's own
provider configuration - both are linked to, never copied.

## 1. Flag inventory

| Key | Description | Category | Owner | Issue | Production default | Targeting strategy | Review date | Removal issue | Date introduced |
|---|---|---|---|---|---|---|---|---|---|
| `reports` | Metric Summary Reports (#190): per-metric alliance rollups, rankings, and member breakdowns. Ships dark - both report routes fail closed (`notFound`) while disabled, and all discovery touchpoints hide their links too. | `temporary-release` | Engineering | #190 | `false` | `global` | 2026-11-11 | [#336](https://github.com/asbillings07/alliance-command-center-app/issues/336) | 2026-08-12 (#336 opened) |

This table is a **human-readable index**, not a second source of truth. If it
ever looks stale, `registry.ts` wins - update the table to match the code,
never the other way around. "Date introduced" is the creation date of the
flag's removal issue, since ADR-019 §8 requires that issue to be opened in the
same PR as the registry entry - there is no separate field for this in the
registry, and there doesn't need to be.

### Checking live state

This table intentionally has **no "current environment/cohort state"
column** - that fact lives exclusively in Vercel Flags (ADR-019 §8's
non-goal: don't duplicate the provider's own configuration UI). To check it:

```bash
vercel flags inspect <key>   # e.g. vercel flags inspect reports
```

This prints per-environment state (Production/Preview/Development),
variants, and `Created`/`Updated` timestamps - Vercel's own audit trail, not
one ACC maintains separately.

**If the CLI isn't available** (no local Vercel auth, a CI box, a reviewer
without the CLI installed), the same information is one click away:

- Open the flag's dashboard page directly - `vercel flags inspect` prints
  this exact URL (`https://vercel.com/<team>/<project>/flag/<key>`), or
  navigate to it from the project's "Flags" tab.
- If dashboard access isn't available either, ask the flag's registered
  `owner` (above) - they are the only one who should be changing it anyway
  (§3), so they always have current knowledge of its state.

"I can't check live state" should never be a dead end during a rollout.

### Drift check (recurring, not one-time)

Registry metadata and live Vercel configuration can only drift apart if
nobody looks. Before any cohort-expansion step in the runbook below (steps
3->4 and 4->6), and at minimum once per Founder Beta slice for any flag that
is still active, the flag's `owner` reconciles the registry row above against
`vercel flags inspect <key>`'s live output - category, targeting strategy,
production default, and whether the review date has passed - and records the
result (matched, or what was corrected) as a comment on the flag's issue.
This is what keeps "auditable inventory" true on an ongoing basis rather than
only on the day the registry entry was written.

## 2. Rollout runbook

A standard sequence for taking a `temporary-release` flag from merged-but-off
to fully rolled out. Every flag follows this; #332 already drafted this exact
shape for `dashboard-workflow-groups`, and this section is that pattern made
reusable for any flag, not a one-off.

1. **Preview verification.** New variant enabled in Preview (independent of
   Production, per ADR-016/ADR-019 §4). Confirm both the enabled and disabled
   paths behave correctly against a Preview deployment.
2. **Production deployment, flag off.** The code ships to Production behind
   the flag's registry `productionDefault: false`. No user-facing change yet
   - this is ADR-011's "deploy is not release" contract in practice.
3. **Internal/platform-operator enablement.** Flip the flag on for
   `operator-only` targeting (or the owner's own test alliance) in the Vercel
   dashboard. Verify the enabled path against real production infrastructure
   with no beta-user exposure.
4. **Selected Founder Beta alliance enablement.** Target one (or a small,
   named set of) Founder Beta alliance(s) via Vercel's alliance-targeting
   rules. This is the first real, alliance-scoped exposure.
5. **Post-enable smoke test and observability review.** Manually exercise the
   enabled path for the targeted alliance(s). Check the flag's own
   feature-specific success/error signal (§4) and Sentry for a new error
   spike scoped to the change. Do not proceed to step 6 until this is clean.
6. **Expanded cohort or full beta enablement.** Broaden Vercel's targeting
   rule (more alliances, then `global`) once step 5 is clean and stays clean
   for a reasonable observation window.
7. **Emergency disable procedure.** See §5 below - available at every step
   above, not just after full rollout.
8. **Flag and old-path removal.** Once rollout is stable and durable (no
   remaining need to disable it), work the flag's removal issue (§6) to
   delete the registry entry, the call sites, and the Vercel flag itself.

## 3. Production configuration authority

Only the flag's registered `owner` (§1) may change its Production targeting
configuration in Vercel (dashboard or CLI). Every change - enabling,
disabling, widening or narrowing targeting - is recorded as a dated comment
on the flag's originating issue or its removal issue, stating what changed,
why, and the expected observable effect. This reuses GitHub issues as the
change log rather than building a separate one, and is the same trail the
drift check (§1) writes to.

This is deliberately lightweight for a small team: Vercel's own
`Created`/`Updated` timestamps (visible via `vercel flags inspect`) already
give a mechanical audit trail of *when* something changed; the issue comment
supplies the *why* that Vercel can't record.

## 4. Observability

- **What gets correlated:** `evaluateFeature` records a Sentry breadcrumb on
  every evaluation containing only the flag key and the resolved boolean
  result (`app/src/lib/featureFlags/evaluateFeature.ts`). If an error is
  captured shortly after, its Sentry event includes the recent flag
  evaluations that led up to it - "was this flag on when it broke" becomes
  answerable from Sentry without a new logging system.
- **What never gets logged:** the breadcrumb never includes `FeatureContext`
  - no alliance id, no user id, no cohort/segment. A regression test
    (`evaluateFeature.test.ts`) asserts this directly, so it isn't only a
    convention.
- **Feature-specific signals are the flag owner's job, not a generic
  system.** Before enabling a flag for any real cohort (runbook step 3+),
  its issue must state what constitutes success and what constitutes a
  problem for that specific feature (e.g. "no new 5xx on
  `/alliances/[id]/reports`", "no more than N leader-reported issues in the
  observation window"). #333 does not build a generic metrics pipeline for
  this (explicit non-goal) - it requires the signal be *defined*, using
  whatever ACC already has (Sentry, direct leader feedback, manual QA).
- **Rollout stop criteria are manual, not automated.** There is no automated
  rollback system in ACC and building one is an explicit non-goal at this
  flag volume (one active flag today). A rollout stops (moves back to a
  narrower cohort, or off) when a human - the flag's owner, or whoever is
  running the smoke test in runbook step 5 - decides the feature-specific
  signal above has been violated, or a leader reports a problem tied to the
  change. Record that decision the same way as any other configuration
  change (§3).
- **Incident/feedback context:** if a leader reports an issue during an
  active rollout window, whoever investigates checks `vercel flags inspect`
  (or the owner) for the relevant flag's current targeting state and
  includes it in the incident write-up ("flag X was enabled for alliance Y at
  the time"). This is a manual step today, not an automatic annotation -
  ACC's feedback/incident tooling doesn't carry flag context automatically,
  and adding that is out of scope here.
- **Flag evaluation is never authorization evidence.** Restated from
  [ADR-019 §6](../adr/019-feature-flag-targeting-lifecycle-contract.md#6-enforcement-boundary--independent-of-and-never-a-substitute-for-authorization):
  a flag being enabled for an alliance says nothing about whether the current
  request is authorized. Observability built on top of flag evaluations
  (this section) must never be read as an authorization or access-control
  log.

## 5. Emergency disable

For **either** flag category, the fast lever is always the same: flip the
flag off (or, for an `operational-kill-switch`, on) in the Vercel dashboard
or via `vercel flags disable <key> --environment production`. This takes
effect without a deploy and is the primary tool at every step of the runbook
above, not just after full rollout.

A **code-level revert and redeploy** ([rollback.md](./rollback.md)) is only
needed when Vercel Flags itself is unreachable, per
[ADR-019 §4](../adr/019-feature-flag-targeting-lifecycle-contract.md#4-environment-defaults-and-failure-behavior)
- in that case the provider's own fallback chain already resolves every
`temporary-release` flag to disabled, so the revert's job is only to remove
code that was depending on a still-unreachable provider, not to "turn
anything off" that isn't already off.

## 6. Retirement workflow

A flag's removal issue (opened at registry-entry creation, per ADR-019 §8) is
the tracking artifact for this. It stays open until rollout is **stable and
durable**: fully and globally enabled, with no remaining scenario in which
the owner would need to disable it again. [#336](https://github.com/asbillings07/alliance-command-center-app/issues/336)
(`reports`) is the concrete template every future removal issue should look
like:

- [ ] Remove the flag's entry from `app/src/lib/featureFlags/registry.ts`.
- [ ] Remove every `evaluateFeature(key, ...)` call site, restoring the
      always-on path (no flag check).
- [ ] Delete the flag from the Vercel dashboard.
- [ ] Remove any test fixtures/mocks that existed only to exercise the flag.

Removing the flag is itself a normal PR, reviewed like any other -
`docs/feature-flag-review-checklist.md` doesn't apply to a *removal* PR
(there's no new flag to check), but the PR should still confirm the old
disabled-path code and any dead branching are fully gone, not left as unused
dead code.

## Related

- [ADR-019](../adr/019-feature-flag-targeting-lifecycle-contract.md) - the architecture contract this document operationalizes.
- [docs/feature-flag-review-checklist.md](../feature-flag-review-checklist.md) - PR checklist for any change that adds or modifies a flag.
- [release-checklist.md](./release-checklist.md), [rollback.md](./rollback.md) - general release/rollback procedures this document extends for flag-specific cases.
- [#333](https://github.com/asbillings07/alliance-command-center-app/issues/333) - the issue this document satisfies.
- [#332](https://github.com/asbillings07/alliance-command-center-app/issues/332)/[#192](https://github.com/asbillings07/alliance-command-center-app/issues/192) - the first flag expected to follow this runbook end to end.
