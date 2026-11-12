# OCR, member submissions, and Go back in time

**Status:** Responsive product design approved by the owner on 2026-11-11. Engineering design and implementation sequencing below are proposed for review; no new access, OCR processing, database behavior, or release is enabled by this document.

**Issues:** [#295 — OCR](https://github.com/asbillings07/alliance-command-center-app/issues/295), [#287 — daily observations](https://github.com/asbillings07/alliance-command-center-app/issues/287), [#42 — Go back in time](https://github.com/asbillings07/alliance-command-center-app/issues/42). Keep #286 as the original discovery reference rather than a parallel OCR implementation.

## Approved responsive direction

The owner approved the revised phone, tablet, and desktop mockups after requesting better small-screen support. These captures contain synthetic people, scores, and illustrative evidence. They are not screenshots of implemented OCR or proof of recognition accuracy. The owner's private game and conversation screenshots are not included.

| Experience | Approved composition | Capture |
| --- | --- | --- |
| Phone upload review | Score and status first; inspect the screenshot and checks on demand; readable controls and full-width actions | [Phone](captures/member-mobile.png) |
| Tablet upload review | Score and game-day context beside each other where space permits; source inspection remains accessible | [Tablet](captures/member-tablet.png) |
| Desktop upload review | Editable candidate beside its source evidence | [Desktop](captures/member-desktop.png) |
| Lower leader score | Compare member and proposed values, show the decrease and consequence, then require explicit confirmation | [Phone](captures/confirm-mobile.png) |
| Go back in time on phones | Compact history list; open one entry at a time, then return to the list | [List](captures/history-mobile.png), [Entry](captures/detail-mobile.png) |
| Go back in time on tablets | History list and selected entry side by side; use the phone pattern when the available width is narrower | [Tablet](captures/history-tablet.png) |

The reviewed mock preserved the approved Alliance Link mark and Private beta header placement. Product identity, shared components, and design tokens remain governed by the existing [design system](../../design-system/brand.md).

### Mock verification and its limits

- Local browser checks covered 110 combinations of viewport and screen state at viewport widths 320, 375, 390, 560, 600, 720, 768, 820, 1024, and 1194 pixels.
- Phone/tablet interactions covered source inspection, confirmation invalidation after editing, missing/wrong-name blocks, eligibility lock, final/progress labels, lower leader confirmation, and historical list/detail navigation.
- Representative desktop, tablet and phone compositions were visually inspected; the owner subsequently approved the revised design.
- These were simulated UI checks, not tests of extraction, permissions, persistence, concurrency, image retention, physical devices, or production behavior. Application acceptance still needs its own tests and human QA.
- Approved fragment SHA-256: `517e9c6c59d1cc88b7904d8992fc052c6d0b5a03d987f9b5cf3ff580b9ddf783`. Captures accompany this record so it remains useful without the chat's local interactive preview.

## Product decisions to preserve

### Access and identity

1. Member OCR unlocks only after a confirmed current in-game name, alliance/server context, and an approved account-to-member link exist. Player ID is optional additional evidence when known and readable.
2. Resolve the member from the authenticated account's approved association. A submitted member ID, OCR text, name, or screenshot cannot approve its own association.
3. Missing, unreadable, ambiguous, or different source names block member acceptance. Associate each score with the name in the same row/panel; a matching name elsewhere in a ranking is insufficient.
4. Authorized leaders may resolve source-name discrepancies through explicit warnings and confirmation of the target and effect. This never bypasses permissions, tenant isolation, date/value validation, or archived-member protections.
5. Source-name matching, image authenticity, game-day association, finality, and leadership authority are separate claims. Editing candidate text does not alter the source evidence or turn a mismatch into a verified match.

### Progress, finality, and authority

- A running countdown means **In progress**. Neither time passing nor uploading after reset makes the original capture final. Missing final evidence is not zero or a completed-day failure.
- Reset follows fixed game-server time, not a fixed Eastern wall-clock time. The owner's 9 PM EDT reference converts to 01:00 UTC / 8 PM EST; validate the actual reset before implementing the schedule. Source-day assignment cannot rely on upload time or an undated countdown alone.
- Repeated cumulative captures in one game day are snapshots of the same score, not separate amounts to add.
- A leader's deliberately saved result takes precedence over member submissions for the same alliance, immutable member, metric/unit, and applicable game-day/result window. This applies to manual entry and supported imports as well as OCR.
- A lower leader result requires confirmation showing both values, the decrease, source context, result status and effect. Recheck at commit; changed evidence, target, period, value or authorization invalidates the earlier confirmation.
- Preserve unresolved higher member evidence for review. An already adjudicated erroneous maximum must not become an unchangeable floor.
- A later member submission remains evidence for leadership review; it cannot silently replace a leader-established value. Leadership priority never silently converts progress into final evidence.

### Go back in time

This is the exact user-facing feature name. It is read-only historical inspection, not a restore button.

For every metric submission or manual entry, retain the subject, metric/unit, result window, submitted value, submitting/entering account, authority at the action, method/source reference, system-recorded time, and source capture time when available. Mark supplied and unknown capture times honestly. Retain corrections, voids, decisions, identity exceptions, comparisons, and confirmation outcomes without erasing originals.

Show two distinct facts: what was submitted at an event, and what the effective record showed **as known then**. A late screenshot must not rewrite what leadership knew earlier. Role changes must not retroactively change historical authority. Unknown legacy attribution must remain unknown.

Recorded values and decision history are separate from image retention. A missing or expired source image must be labeled; do not promise indefinite image storage. Any future correction or reversal creates a separately authorized event rather than changing history while browsing it.

## Existing implementation audit

Checked against main commit `5419ba352122a80d9ed4055a5dce4e40797d98f4` before preparing this document.

| Existing capability | Reuse / gap |
| --- | --- |
| [`AllianceMember.userId`](../../../prisma/schema.prisma) already links a tracked member to a user | Reuse or deliberately extend this relationship. Its presence alone does not establish the newly required approval, confirmed-name lifecycle, or exclusive self-submission permission. Do not create a second identity system merely for OCR. |
| [`AllianceRole` and permission matrix](../../../app/src/lib/auth/permissions.ts) contain OWNER, ADMIN, LEADER, VIEWER | VIEWER can view alliance members and leadership notes. It is not an ordinary-member portal role. Preserve these existing collaborator permissions; define own-record access separately. |
| [`MemberMetricEntry`](../../../prisma/schema.prisma) has value, grain, observation date, active/void status and system timestamps | It does not currently carry uploader identity, source method, screenshot evidence, authority-at-action, or progress/final evidence status. Do not manufacture those for old rows. |
| [ADR-018](../../adr/018-metric-observation-rollup-domain-model.md) and the [canonical read model](../../../app/src/lib/metrics/memberPeriodMetricValues.ts) resolve within-slot corrections using `(recordedAt, createdAt, id)` | This does not implement leader-over-member authority or historical knowledge cutoffs. The approved behavior needs an explicit amendment and consumer audit. `ACTIVE` is not synonymous with `Final`. |
| Existing metric recording/import actions use transactions, scoped validation and shared invalidation | Extend those boundaries; do not create an OCR-only write path with different protections. |
| [#277 roster import recovery](https://github.com/asbillings07/alliance-command-center-app/issues/277) is closed and implemented | Reuse its bounded preview, conflict reporting and audit principles. It does not supply metric-result rollback. Metric correction/void semantics must remain append-only. |

## Proposed implementation sequence

These are reviewable slices under the existing issues, not approval to merge or deploy them. Do not close the parent issues when only a foundation lands.

### 1. Observation provenance and resolution contract — #287 / #42 / #295

First prepare the ADR-018 amendment and database design for review. Distinguish a submission, its source/capture context, and an authorized decision that changes which result is used. Prefer a small extension of the existing metric history over a parallel generalized event system.

The design must specify:

- Server-derived attribution for all metric writers, including manual entry, single-period import, multi-period import, corrections/voids and future OCR. Preserve immutable identity/authority evidence without relying on the user's current display name or role.
- How approved source context, progress/final status, and leadership decisions are persisted and resolved. A pending later member submission must be retained without becoming the active report value merely because it was written last.
- A stable historical cutoff and ordering contract. ADR-018's timestamp/id tiebreaker is not a claim about transaction commit order; a truthful “as known then” view needs an explicit rule and concurrency tests.
- Legacy behavior and unknown attribution, forward-only migration sequencing, and the compatibility window while old and new application versions coexist. Do not relabel legacy rows as member, leader, screenshot-verified or final by guesswork.
- Every read path's treatment of progress, pending evidence, voids and finality. Audit reports, roster values, period totals, setup/coverage and activity separately. Missing finals and repeated snapshots must not distort aggregates.
- Atomic stale-confirmation checks against the same target, window and compared evidence, with retries that cannot duplicate accepted submissions or accidentally reuse an old confirmation.

Then implement one focused provenance/history slice with real PostgreSQL tests before enabling member or image ingestion. The existing rollup's behavior remains unchanged until the resolution change is reviewed and tested.

### 2. Own-record access and eligibility — #295

Implement the approved account/member association and own-record authorization workflow. Keep existing invitation/account eligibility rules and collaborator permissions intact. Verify approval, revocation, rename/relink, archived member and cross-alliance cases on the server before processing and again before accepting a result. Membership, identity and role changes during a pending upload must invalidate review.

An ordinary member must never gain roster-wide records, leadership notes, reports or another member's data through a guessed route or identifier. Do not solve access by assigning VIEWER.

### 3. Screenshot extraction and review — #295

Validate a small supported-screen corpus first, then integrate extraction behind a replaceable boundary. Reuse canonical number parsing, metric validation, overlap/duplicate handling and transactional commit rules. The approved phone/tablet review flows are acceptance targets.

Support the name-blocking states and explicit leader exceptions alongside lower-score confirmation; approving the refreshed score/history layouts did not remove the earlier identity safeguards. Source review remains available at every supported size.

### 4. Go back in time UI and joined acceptance — #42

Build a bounded, paginated history from the reviewed data contract. Preserve the approved phone list/detail and tablet split layouts, keyboard navigation, visible focus and readable controls. Test real persistence and a reload, not only local interaction state.

Prove the full sequence: member progress → later progress → completed result → lower leader decision → later higher member evidence awaiting review. Earlier values, author/source details and historical effective values must remain available; browsing history must not mutate the current result.

## Evidence and operational decisions still to resolve

These do not prevent starting provenance and access work, but must be settled before the relevant capability is enabled:

- Representative in-game completed-day screens and reliable date/capture context; the mock's final screen was illustrative.
- Actual fixed reset observation and the game-day label/window mapping to ADR-018's existing civil-date and period rules.
- OCR execution/provider choice, supported image formats and upload limits, cost/rate limits, temporary-file handling, retention/deletion, and whether raw images leave ACC's controlled environment. No private sample is approved for an external OCR provider by this mock approval.
- How OCR confidence, Unicode names, visually similar names, duplicate ranking rows and edited numeric candidates are qualified against representative fixtures. Recognition confidence does not grant identity authority.

## Release acceptance

- Existing tenant, permission, import, metric and reporting safeguards continue to pass.
- Database checks cover append-only history, legacy parity, concurrent/stale confirmation, duplicate retry, and authority/finality resolution.
- Full browser journeys cover member and leader actions on phone, tablet and desktop, including both identity and lower-score warnings, failures and recovery.
- Independent engineering review, green required CI, and human QA apply to the implemented candidate. Mock approval is not implementation QA or a merge/deployment approval.
- The live application remains unchanged until an implementation candidate is separately reviewed and release is authorized.
