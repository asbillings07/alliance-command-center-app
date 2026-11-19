# ADR-020: Paired user and alliance feature targeting

Status: Proposed in #405; extends ADR-019 without rewriting that accepted record.

## Context and decision

The OCR pilot must be offered to selected accounts inside their authorized alliance. An alliance-wide rule alone exposes the trial to every importer. Add `user-and-alliance-targeted` to the existing registry. Require both trusted identities before evaluating it, including in deterministic local tests. Vercel owns the live cohort; configure user ID AND alliance ID in the same rule, with an Off fallback. Missing context cannot fall through to a broad provider rule.

Reuse `evaluateFeature`, the existing Vercel adapter and its per-call trusted entities. No second rollout store, client cookie authority or decision cache. OCR resolves identities from its DB-backed authorization and evaluates at every independent read/mutation boundary, before budget reservation, before Google dispatch, after provider/storage responses and before finalization. QA setup uses the same release control after importer authorization. A flag never grants role, membership, identity confirmation or approved member access.

Keep ADR-019's resolution contract: the SDK's valid stream/poll/datafile/embedded configuration remains usable. An exhausted resolution or configuration failure denies OCR. This is not a promise of immediate revocation during a provider outage, and a request already dispatched cannot be recalled. Disable the QA environment switch and redeploy if an unavailable provider prevents confirming Off. Never refund or erase consumed reservations as evidence of disabling.

The existing QA-only environment/branch/database boundary, alliance allowlist, $5 lifetime budget and private 30-day retention remain independent requirements. Production is not enabled by this change. Accepted-score application remains a separate, unfinished slice.

## Consequences and evidence

Targeted and untargeted accounts in the same alliance can receive different release decisions while retaining identical permissions. Historical records survive a flag change. New screenshot requests fail with an explicit unavailable message; ordinary spreadsheet/manual workflows remain usable. Private source reads also stop, without deleting retained sources or history. No schema migration or new dependency is needed.

Validate exact-pair targeting, missing context, provider failure, wrong role/alliance, in-flight disable, direct API/routes and responsive disabled states with synthetic fixtures. Then qualify the real provider's enabled/disabled behavior in isolated QA without new paid scans. Record configuration evidence in #405 and review the flag lifecycle in #406.
