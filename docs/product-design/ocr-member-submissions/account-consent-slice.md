# Account consent: #411 / #409

AB approved the revised responsive flows and implementation on November 19.
This is the first complete Human QA slice of #409. It is not the completed
decision dashboard, final score acceptance, cohort activation or release.

## Account decisions

First use asks for OCR processing only, before any file chooser or service upload.
The choice is stored against the authenticated account, with notice version and
server time. Decline does not repeatedly prompt; deliberate re-enabling belongs
in Account → OCR Settings. There is no consent backfill for earlier uploads.

Optional human quality review is off by default and appears only in Settings.
Default off creates no refusal record. Turning it off does not stop OCR. An
upload records the active quality-consent decision ID, if any. Later opt-in does
not cover older uploads; off then on creates a new decision and does not revive
old source eligibility. Original source expiry is never changed.

Preferences do not grant a role, alliance access, selected-user rollout access,
an allowance increase, or human reviewer access. Every existing authorization,
identity and source-alliance check remains. Platform cannot consent for users.

## Persistence and enforcement

`OcrConsentDecision` is append-only through the domain service. Changes serialize
on the account; `ocrConsentVersion` invalidates stale Serializable processing
snapshots. Conditional writes reject a stale opposite choice; identical delivery
is a no-op. The actor comes from server authentication, not a submitted account ID.
Personal Settings remain available in the isolated environment when the global
scan switch is off, so disabling processing never prevents withdrawal.

Processing permission is checked before multipart ingestion, before admission,
before storage/recognition dispatch, after external responses, and when reading
retained results. A separate processing-permission reference binds in-flight operations, so
revocation followed by re-enabling cannot silently resume them. Shared roster/
identity context stays independent of a viewer's personal consent decision;
authorized colleagues can still inspect retained scans with their own consent. Revocation cannot
recall an already-dispatched operation. Any reserved allowance and attempt
history remain recorded, including failures. The lifetime $5 ledger and 30-day
private source expiry are unchanged.

Internal provider costs and trial dollar limits belong only in explicitly
labelled QA controls or operator evidence. Shared upload/retry messages explain
the action, preserved history and available fallback without implying a user
charge. QA controls remain server-gated to the isolated evaluation database.

The gate refreshes on foreground return and same-browser preference broadcasts;
server enforcement does not depend on those UI updates. A revoked account sees
no active screenshot controls. Saved metric history is unaffected. Manual and
spreadsheet authorization is unchanged.

The quality eligibility predicate is a necessary condition, never authorization
by itself. The later restricted audit reader must check reviewer permission,
collection decision, current decision and original expiry both before and after
storage access. This slice adds no quality-audit reader or source grant; nobody
gains new source access from enabling the setting. Consent rows are personal
account records, not analytics. Account deletion removes these decisions, which
also removes the continuing permission needed for quality access. Existing
attempt records retain their original historical decision references.

## Next slices and truthful evidence

The current OCR flow stops at recognition review and writes no accepted scores.
Its completion button must not produce a usable-import event. #400 governs the
accepted-score/history boundary required before joined import confirmation.
After this consent QA gate, #409 still needs journey measurement, restricted
audits, matched timing, return/preference/economics evidence and the Platform
decision view. Missing evidence must remain “Not enough evidence.” Synthetic
qualification does not count toward the real cohort; no real enrollment or
research collection is activated here.

## Verification / Human QA

- Unit tests: default-off, independence of choices, legacy/expired sources,
  withdrawal and re-enabling, notice versions and authenticated action subjects.
- PostgreSQL: account persistence, stale changes, provider-boundary revocation,
  immutable attempts/reservations, source eligibility and unchanged score writes.
- Browser: desktop/tablet/phone first use, decline, reload, Settings, cancellation,
  optional review, revocation, re-enable, cross-alliance reuse and direct requests.
- Existing OCR browser and authorization regressions remain required.

Use the existing isolated QA account. No new Google scan is required to review
these controls. Merge, production deployment, public rollout and billing remain
on hold. #407 remains a separate unmerged dependency; this PR is stacked on it.
