# ADR-019: Feature Flag Targeting, Trust Boundary, and Lifecycle Contract

**Status:** Accepted

**Date:** 2026-08-11

## Context

[#330](https://github.com/asbillings07/alliance-command-center-app/issues/330) ("Add alliance-targeted feature flags for safe production rollout") observes that every merge to `main` deploys to production ([ADR-011](011-continuous-delivery.md)), and Founder Beta releases are becoming large enough — starting with [#192](https://github.com/asbillings07/alliance-command-center-app/issues/192)'s dashboard workflow redesign, gated by [#332](https://github.com/asbillings07/alliance-command-center-app/issues/332) — that code deployment and user-facing release must be separable. ACC's only existing mechanism ([`app/src/lib/features.ts`](../../app/src/lib/features.ts)) is five build-time environment booleans with no per-request context: a flag is either on for every alliance everywhere, or off everywhere. That is enough for `reports` (#190), the one flag actually gating real behavior today, but not for "enable this for three selected Founder Beta alliances while everyone else keeps the current experience."

[#334](https://github.com/asbillings07/alliance-command-center-app/issues/334) asks for exactly one thing before any package is chosen or any runtime evaluation code is written: an accepted, explicit contract for what a flag means, what may influence it, how failure resolves, where it is enforced, and when it must be removed. This ADR is that contract. [#331](https://github.com/asbillings07/alliance-command-center-app/issues/331) (typed evaluator + Vercel Flags integration) and [#333](https://github.com/asbillings07/alliance-command-center-app/issues/333) (rollout governance/observability) implement against it; [#332](https://github.com/asbillings07/alliance-command-center-app/issues/332)/[#192](https://github.com/asbillings07/alliance-command-center-app/issues/192) is the first production proof.

**Reconciliation with existing ADRs, up front, because both are load-bearing for every decision below:**

- **[ADR-006](../../AGENTS.md)** (authorization is always enforced on the server; hidden UI is not security): a feature flag is a *release* control, never an *authorization* control. Every decision in this ADR keeps those two concerns independent — a flag can withhold a capability from everyone, but it never grants one to someone authorization would otherwise deny, and authorization is checked unconditionally regardless of flag state (§6).
- **[ADR-011](011-continuous-delivery.md)** (every merge to `main` is deployable; "feature flags control user-facing changes"): this ADR is the mechanism that promise already assumed existed. Preview remains ACC's staging substitute (ADR-011, ADR-016) and gets its own independent flag configuration (§4).

## Decision

### 1. Flag categories

Only two categories are supported today. Both are **temporary** — every flag created under this contract has a removal issue (§8) from day one.

| Category | Meaning | Default posture | Example |
|---|---|---|---|
| Temporary release flag | Gates an unreleased or partially-rolled-out user-facing change | Starts disabled; enabled by targeting as rollout proceeds | `dashboard-workflow-groups` (#332) |
| Operational kill switch | An escape hatch to disable an already-released, stable workflow in an emergency | Starts "not killed" (normal operation); flipping it is an incident response action | A future emergency disable for a shipped workflow, if a concrete need arises |

**Explicitly excluded, not merely deferred:**

- **Experiments/variants** are not supported. `evaluateFeature` (§9) returns a `boolean`, never a string/number/JSON variant, even though the Vercel Flags SDK itself supports non-boolean flags. Nothing here blocks adding a separate `evaluateVariant`-style API later if a real experimentation need appears — it would be an addition, not a change to this contract — but building that capability speculatively now is exactly what [AGENTS.md](../../AGENTS.md) asks us to avoid ("avoid ... speculative features").
- **Durable entitlements/capabilities are not feature flags.** If a capability becomes something an alliance durably has or does not have (a paid plan tier, for instance), that is domain/subscription data modeled in Prisma with its own authorization check — never encoded as a flag whose "off" state would need to survive indefinitely. A flag that stops having a removal issue has quietly become an entitlement and must be migrated out of this system, not left in it.
- **Authorization/permissions are never modeled as a flag.** `AllianceMembership` roles/permissions (ADR-006/007) are the only authorization mechanism; a flag never substitutes for `requireAllianceAccess` or an equivalent permission check (§6).

### 2. Evaluation context (`FeatureContext`) and the trust boundary

```ts
type FeatureContext = {
  environment: "production" | "preview" | "development";
  alliance?: { id: string; cohort?: string };
  userId?: string;
  isPlatformAdmin?: boolean;
};
```

**Every populated field must be the return value of ACC's own canonical authorization/tenant resolver — never a value read directly from `params`, a request body, a header, or a cookie.** A route parameter is client-originated regardless of which server function reads it; "resolved server-side" is not by itself a trust claim. Concretely: `alliance.id` and `alliance.cohort` come from whatever `requireAllianceAccess` (or an equivalent authorization call) returns for the current request, `userId` from the authenticated session, and `isPlatformAdmin` from the same DB-backed check `requirePlatformAdmin` already uses ([`app/src/lib/auth/requirePlatformAdmin.ts`](../../app/src/lib/auth/requirePlatformAdmin.ts)) — never a JWT-only hint.

**Ordering: authorization completes first and independently, and only its resolved output feeds the evaluator — but only when the flag's evaluation actually uses `alliance` or `userId` context.** A **context-free global flag** (`environment` only — the shape `reports` needs today) is exempt from this ordering and may still evaluate before authorization, preserving the existing "flag off → `notFound()` before any auth/DB work" pattern the `reports` route guards already implement ([`app/alliances/[allianceId]/reports/page.tsx`](<../../app/alliances/[allianceId]/reports/page.tsx>)). Any flag whose targeting strategy is `alliance-targeted` or `operator-only` (§8), by contrast, cannot resolve correctly until authorization has resolved the tenant/user it targets against, so authorization must run first for those.

`environment` is always safe to forward to the provider. `alliance`/`userId`/`isPlatformAdmin` are forwarded as Vercel Flags ["entities"](https://vercel.com/docs/flags/vercel-flags/dashboard/entities) only after the above resolution — the provider receives ACC's already-trusted answer, never an opportunity to be handed something client-supplied.

### 3. Re-evaluation boundary — one evaluation per independent execution boundary

A resolved flag value is never carried across independent execution boundaries. Each of the following evaluates fresh, every time:

- **Page / server component render** — evaluates for rendering that request.
- **Server action / API route** — evaluates again, after authorization, immediately before any side effect. A page's earlier render-time evaluation never substitutes for this.
- **Background / queued job** — evaluates at execution time, not at enqueue time. The job persists only **stable identifiers** (e.g. `allianceId`) alongside its payload — never mutable attributes such as cohort/segment membership, which are re-resolved fresh from their source of truth at execution time. Persisting a snapshot of mutable context would let an otherwise-fresh evaluation act on membership that was already stale by the time the job ran.
- **Client components** receive only an already-resolved `boolean` from their server parent — never a flag key, provider credential, or the ability to influence evaluation. A client-supplied value is never accepted as evaluation input, in either direction.

**Consequence:** if a flag changes between an earlier page render and a later mutation triggered from that same page, the mutation's own evaluation is authoritative and must reject the now-disabled action safely — a typed unavailable result, no partial side effect (§5) — rather than treating the render's earlier "on" as a promise the mutation must honor. Within one boundary, evaluation is resolved once and does not change mid-boundary; a workflow cannot "disappear" partway through rendering a single page.

### 4. Environment defaults and failure behavior

**Environment defaults:**

| Environment | Default when unconfigured |
|---|---|
| Production | Disabled, unless provider configuration explicitly enables it for the resolved context |
| Preview | Disabled, unless explicitly enabled — configured independently of Production (ADR-016) |
| Development / local | Disabled by default; an explicit developer-only override is allowed, never trusted in Production/Preview |
| CI | Disabled by default; tests inject deterministic values through a test adapter that bypasses the real provider entirely |
| Missing/invalid provider configuration | Disabled |

**Failure behavior is implemented through the chosen SDK's own fallback chain, not a second ACC-level cache.** ACC's provider boundary (§9) is the **Flags SDK** (`flags/next`), which declares each flag as `flag({ key, decide, defaultValue, adapter, identify })` — the `adapter` (`@flags-sdk/vercel`) supplies `decide`, and that adapter is itself backed by Vercel Flags' resolution path: a real-time stream, interval polling, an optional provided datafile, and — if all of those are unavailable — a **build-time embedded-definitions snapshot** bundled into the deployment specifically as a runtime-resilience fallback ([Vercel Flags](https://vercel.com/docs/flags/vercel-flags), [core evaluation engine docs](https://vercel.com/docs/flags/vercel-flags/sdks/core#embedded-definitions) — the lower-level engine the Vercel adapter is built on; ACC does not call this core library directly). Vercel Flags is a distinct product from Edge Config; it is not backed by it. A value resolved through **any** stage of that chain — including the embedded snapshot — is a legitimate resolved value exactly as Vercel intends, not something ACC treats as stale or a "cache" requiring a separate distrust policy. ACC does not build its own caching/staleness layer on top of it.

**The registry supplies the category-specific `defaultValue`. The Vercel adapter owns its provider fallback chain. If the adapter cannot resolve a value, the Flags SDK returns the declared default.** ACC's category default is implemented as exactly that `defaultValue` parameter on each flag's `flag(...)` declaration — no separate "is the provider reachable" branch in ACC's own code. Exactly how a resolution failure surfaces through the adapter (a thrown error inside `decide`, or a value passed through from the underlying engine) and exactly how trusted `FeatureContext` is threaded in via `identify` are #331's implementation-time wiring — this ADR fixes only the resulting behavior:

| Flag category | Adapter resolves a value (stream, poll, datafile, or embedded snapshot) | Adapter's resolution fails entirely |
|---|---|---|
| Temporary release flag | Use the resolved value as-is | Falls back to the declared `defaultValue`: **disabled** — matches #330's "Production must fail closed for unreleased features" |
| Operational kill switch | Use the resolved value as-is | Falls back to the declared `defaultValue`: **not killed** (normal operation continues) — the switch protects already-vetted, stable functionality; failing an unrelated provider outage to "killed" would be a disproportionate, self-inflicted incident |

- **Emergency disable when Vercel Flags itself is unreachable:** the fallback is a code-level revert and redeploy — already a fast, exercised path per ADR-011's deploy-on-merge model, not a second flag mechanism. (A redeploy also re-embeds a fresh build-time snapshot, so it is a real lever, not merely "wait for the provider to recover.")
- **Strict live-read-only evaluation** (distrusting the embedded snapshot too, for a flag whose staleness tolerance must be near zero) is an explicit, opt-in escape hatch for a specific flag, not the default policy. Reaching for it requires proving the SDK can expose per-result freshness/reason data for that flag and disabling embedding (`VERCEL_FLAGS_DISABLE_DEFINITION_EMBEDDING=1`) — an implementation-time decision for whichever flag actually needs it, not something #331 should invent globally.

### 5. Disabled behavior is explicit per surface

| Surface | Disabled behavior |
|---|---|
| New, previously unreleased route | `notFound()` |
| Replacement/redesign of an existing route | Render the stable old experience |
| Server action / API | Typed unavailable result; no side effect |
| Background job | Skip safely and emit an operational record (never silently drop the job with no trace) |
| Kill-switched, previously active workflow | An explicit temporary-unavailable state — never a silent `notFound()`, since the feature was working moments ago and a 404 would misrepresent that as "never existed" |

### 6. Enforcement boundary — independent of, and never a substitute for, authorization

One evaluation (§3) gates whichever of the following are relevant to a given flag: navigation/discovery links, direct pages/routes, server components and data reads, server actions/APIs, and background/queued work. Client components receive only the already-resolved value (§3) — a flag never ships provider credentials or trusts a client-side evaluation.

**Hiding UI is never sufficient for a protected mutation or an unreleased direct route** — the same principle ADR-006 already states for authorization applies identically here. A flag and an authorization check are always both present and always independently enforced on the server; neither is a substitute for the other, and a flag is never the only thing standing between an unauthorized user and a protected action.

### 7. Data and migration rules

- Any schema change needed to support a flagged feature must be additive/backward-compatible — valid whether the flag is on or off for a given request.
- The old and new code paths behind a flag share the same domain services and invariants. This ADR does not sanction a long-lived forked implementation of the same business rule; §1's "temporary" framing exists specifically to prevent that.
- Data written while a flag was enabled must remain valid and readable if the flag is later disabled — rollback is a code-level flag flip, never a database reversal. An old/new pair of code paths must never require incompatible dual-write behavior to stay consistent with each other.

### 8. Lifecycle and registry requirements

Every flag is defined once, in one server-only typed registry, with:

- A typed key and human-readable description.
- Category (§1: `temporary-release` or `operational-kill-switch`).
- Owning issue and owner.
- Production default.
- **Targeting dimension/strategy** — `global`, `alliance-targeted`, or `operator-only` — describing *how* the flag can be targeted, never the live alliance list or segment membership itself. That list is exclusively Vercel Flags configuration (dashboard targeting rules/segments); the registry recording it too would create a second, driftable source of truth for the same fact.
- Expiration/review date.
- **A removal issue — required when the registry entry is introduced, not merely before broad enablement or deletion.** This is the stronger of the two options and the one this ADR requires: §1 already establishes every flag as temporary from day one, so the registry entry that creates a flag and the removal issue that will eventually retire it are opened together, in the same PR. [#333](https://github.com/asbillings07/alliance-command-center-app/issues/333) owns the operational runbook (rollout sequencing, who may change Production configuration, observability, retirement) built on top of this registry; this ADR only fixes the registry's shape.

Referencing an undefined flag key is a compile-time error, not a runtime surprise.

### 9. Provider boundary — Vercel Flags behind ACC's own typed API

ACC adopts the **Vercel Flags SDK** (the Next.js-native "Flags SDK", not the lower-level core library or a hand-rolled Edge Config integration) as the initial provider, per #330's recommendation, for its built-in dashboard-configured targeting rules, segments, per-environment configuration, and the resilience fallback chain in §4. **Vercel Flags is currently in beta.** Nothing about that changes any decision above, but it is exactly why no page, server action, or domain service is permitted to import the provider package directly — every consumer goes through ACC's own typed boundary, so the provider can be replaced without touching a single page, route, or domain service:

```ts
function evaluateFeature(
  flag: FeatureFlagKey,
  context: FeatureContext,
): Promise<boolean>;
```

`evaluateFeature` is the one primitive. It does not itself decide what "disabled" renders as — the call site applies whichever row of §5's table matches its own surface, explicitly, in the code that owns that surface. This keeps the surface-specific decision visible where it's made rather than hidden inside a generic guard helper, consistent with [AGENTS.md](../../AGENTS.md)'s "readability over cleverness."

Registry entries (§8) are declared through a typed definition, e.g. a `Record<FeatureFlagKey, FeatureFlagDefinition>` — #331 owns the exact registration API's ergonomics; this ADR fixes only the field list in §8 and `evaluateFeature`'s name/signature, since #331 explicitly implements against whatever this ADR decides here.

### 10. Existing flag disposition

| Existing flag | Disposition | Rationale |
|---|---|---|
| `platformConsole` | **Delete.** Do not migrate. | Unused — real enforcement is already the DB-backed `isPlatformAdmin` check ([`app/src/lib/auth/requirePlatformAdmin.ts`](../../app/src/lib/auth/requirePlatformAdmin.ts)), never this flag. If an emergency platform-console kill switch is ever needed, it is a new, separately named operational flag evaluated in addition to authorization — not a revival of this one. |
| `recognition` | **Delete.** Do not migrate. | Unused, speculative ("future"). A real temporary flag is created if/when that work actually starts. |
| `discordIntegration` | **Delete.** Do not migrate. | Same reasoning as `recognition`. |
| `analytics` | **Delete.** Do not migrate. | Same reasoning as `recognition`. |
| `reports` | **Migrate.** | The only flag gating real behavior (#190). #331 migrates it into the new typed registry in one atomic cutover that preserves its current production value and fail-closed route/discovery behavior, validated by a parity check against the current `isFeatureEnabled("reports")` behavior, then removes `FEATURE_REPORTS` from the environment. |

`reports` becomes a `global`-targeting-strategy, `temporary-release`-category flag under the new registry; #332's `dashboard-workflow-groups` (#192) is the first `alliance-targeted` flag exercising real targeting under this contract.

## Non-goals

- Implementing the Vercel Flags provider adapter, the typed evaluator, or the flag registry itself — [#331](https://github.com/asbillings07/alliance-command-center-app/issues/331).
- Building rollout governance, observability wiring, or the retirement runbook — [#333](https://github.com/asbillings07/alliance-command-center-app/issues/333).
- Any dashboard-redesign code — [#192](https://github.com/asbillings07/alliance-command-center-app/issues/192)/[#332](https://github.com/asbillings07/alliance-command-center-app/issues/332).
- Designing paid-plan entitlements (§1 explicitly excludes durable entitlements from this system).
- Client-side authorization or shipping provider SDK credentials to the client.
- A percentage-rollout/experimentation capability beyond what Vercel Flags' own targeting rules already provide for alliance/segment targeting.
- A new Prisma model or database table for flag targeting (§2, §8) — enrollment lives in the provider; a DB model becomes appropriate only if enrollment later becomes a durable entitlement, needs an ACC-operated management UI, or must participate in a domain workflow, none of which is true today.

## Consequences

- `app/src/lib/features.ts` and its five env vars are superseded; #331's atomic cutover deletes `platformConsole`/`recognition`/`discordIntegration`/`analytics` and migrates `reports`, then removes `FEATURE_REPORTS` from `app/src/lib/env.ts` and the environment.
- Every alliance-scoped page/action/job that adopts a flag must resolve `FeatureContext` from its own authorization/tenant resolution, not from raw request data — this is a new discipline requirement for #331's consumers, not something the type system alone enforces.
- #332/#192 is the first flag exercising `alliance-targeted` strategy end-to-end and is where this ADR's re-evaluation-boundary (§3) and disabled-by-surface (§5) rules get their first real, non-`reports` proof.
- A flag without a removal issue, or one still live long after its review date, is a process violation #333's governance workflow is responsible for catching — this ADR fixes what the registry must record, not the ongoing enforcement of it.

## Verification plan (acceptance bar for #331)

Mirrors [#331](https://github.com/asbillings07/alliance-command-center-app/issues/331)'s acceptance criteria; recorded here so #331 implements against a bar this ADR already fixed, not one invented during implementation:

- On, off, missing configuration, and provider-fallback-chain-exhausted cases each resolve exactly as §4's tables specify, for both flag categories.
- Alliance-targeted and operator-only evaluation is covered for a targeted alliance/operator, an untargeted one, and a wrong-user/wrong-cohort case — all denied or granted per the resolved `FeatureContext`, never per client-supplied input.
- A single request exercises `evaluateFeature` at more than one execution boundary (e.g. a page render followed by a server action) and each call is shown to evaluate independently, per §3 — including a flag-flip-between-boundaries case where the later boundary's evaluation, not the earlier one, is authoritative.
- `reports`' current production behavior (fail-closed `notFound()` before authorization, discovery hidden, client components receive only a resolved boolean) is unchanged after migration — a parity test against `isFeatureEnabled("reports")`'s existing test suite.
- No flag path bypasses `requireAllianceAccess` or an equivalent authorization check, for any flag state.

## Related work

- [ADR-006](../../AGENTS.md) — authorization is always server-enforced; a flag is a release control, never an authorization control (§6).
- [ADR-011](011-continuous-delivery.md) — continuous delivery; this ADR is the mechanism that decouples deploy from release that ADR-011 already assumed.
- [ADR-016](016-preview-production-isolation.md) — Preview/Production isolation; Preview's independent flag configuration (§4) follows the same isolation principle.
- [#330](https://github.com/asbillings07/alliance-command-center-app/issues/330) — the parent initiative this ADR is the first child of.
- [#331](https://github.com/asbillings07/alliance-command-center-app/issues/331) — implements the typed evaluator and provider adapter against this contract.
- [#333](https://github.com/asbillings07/alliance-command-center-app/issues/333) — builds rollout governance and the retirement workflow on top of this contract's registry (§8).
- [#332](https://github.com/asbillings07/alliance-command-center-app/issues/332) / [#192](https://github.com/asbillings07/alliance-command-center-app/issues/192) — the first production proof of alliance-targeted rollout under this contract.
- [#190](https://github.com/asbillings07/alliance-command-center-app/issues/190) — `reports`, the one existing flag migrated rather than deleted (§10).
