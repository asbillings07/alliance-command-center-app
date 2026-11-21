# Screenshot evidence and score-review qualification

Issue #400, under #295 / #287 / #42. This amendment is a **prepared implementation contract**, not activation of OCR or a new result writer. The pure `app/src/lib/ocr/scoreReview.ts` module is exercised with synthetic events and is not imported by production routes or metric readers. Existing approved responsive designs remain the UI target.

## Separate evidence from accepted results

A screenshot observation is evidence about a specific alliance, immutable member, metric, unit and explicitly resolved result window. No context component is inferred from upload time. No reset schedule is implemented here. Missing source date/context requires resolution before admission. A running countdown means in-progress; missing final evidence means unknown, not zero or a completed day.

Do not insert member submissions directly into `MemberMetricEntry`. Its current canonical readers use correction order and would let a later member upload silently replace a leadership decision. Keep admitted screenshot/member evidence outside that accepted-value path until a reviewed transactional adapter can write an explicit leadership decision and its resulting metric entry atomically. This is a domain boundary, not a second generalized event platform.

The first resolver has no automatically selected member value. It returns the accepted leadership decision (or none) and all pending member evidence. Cumulative captures are never summed or chosen by maximum/arrival time. A leadership decision remains authoritative when more member evidence arrives. A leader can consider or reject specific pending observations with a reason; original evidence remains in the ledger. An already-rejected mistaken maximum is excluded from future comparison floors.

## A comparison receipt, not authority

For a proposed leader value, enumerate every unresolved comparable member observation with a higher value, including any the proposal intends to reject. The review identifies each source and its finality/capture context. The UI must display member, metric/unit, result window, old/new values and reduction, and explain the report effect before a separate lower-score acknowledgement. Ordinary save confirmation does not satisfy that acknowledgement.

The comparison receipt binds the exact context, committed revision, current accepted decision, pending evidence, proposed value/source/finality/capture context and proposed resolutions. Any intervening evidence or edit invalidates it. The receipt is not secret, does not authenticate anyone, and can never replace server-side authority, tenant checks, identity validation or a fresh transactional read. Identity-warning confirmation remains a distinct admission concern; it is not waived by a lower-score confirmation.

The pure resolver rejects a leader event whose action-time role is MEMBER or unknown, but this is only input validation. The future adapter derives actor ID/name/role from the authenticated server context and rechecks the focused operation permission under lock. No submitted role field can confer leadership authority. Ranking imports do not require each target player to have a linked account; that prerequisite belongs only to member self-submission.

## Finality is a separate claim

Unknown and in-progress remain unchanged after a leader decision. Time passing, upload order, or the larger number never promote them to final. The synthetic qualification type can represent final evidence only with a stable evidence reference; the reference itself does not prove finality. Production admission of final evidence stays disabled until completed-window screens and their review rules are qualified.

If pending or accepted final evidence would be replaced by an unknown/in-progress proposal, the resolver reports the conflicting evidence IDs and blocks that decision. It does not invent a downgrade rule or silently carry forward a Final label. A future reviewed conflict workflow must preserve both the earlier final evidence and the explicit resolution.

## Persistence and historical boundaries — required before activation

The pure module consumes a complete, bounded, contiguous committed prefix for one result context. These revisions are a **required future persistence guarantee**, not a claim about today's schema. Database sequences, `recordedAt`, UUID order and client timestamps are not commit clocks.

The smallest proposed durable adapter is a result-context row, immutable submission/decision rows, and an idempotency key scoped to actor/context. Serialize all changes for that context by locking the row; increment its revision in the same transaction only when the evidence/decision and any accepted metric entry commit. Read a historical cutoff from the same committed context revision. Rollback cannot consume a visible revision or expose a partial accepted decision. Record action-time actor snapshots, source/capture provenance, exact compared evidence and acknowledgements. Preserve source observations and decisions on correction; do not mutate previous history. Account or source-image removal must not erase metric attribution.

A future write adapter must prove with PostgreSQL races:
- concurrent member evidence invalidates an older leader comparison;
- permission, identity or own-record grant revocation invalidates pending admission;
- duplicate retries return the same committed outcome rather than duplicate evidence;
- a failed/interrupted response is resolved by inspecting durable history, never presumed rollback;
- historical prefixes preserve what had committed at that boundary, including late captures;
- accepted-value projection and audit event commit together, and tenant/context boundaries cannot be crossed.

No schema migration or adapter is introduced in this qualification slice. The 1,000-event bound makes the offline evaluator fail explicitly instead of truncating history; a production reader must use a tested snapshot/continuation design or a suitably bounded result-window contract, never pass an arbitrary page as complete history.

## Compatibility and remaining joined acceptance

ADR-018's current legacy readers, daily rollups and all manual/spreadsheet writes retain their existing behavior. Unknown historical attribution/finality stays unknown. Before any new accepted screenshot value can affect reports, audit every `MemberMetricEntry` reader/writer and qualify the projection, incomplete-day handling, repeated snapshots, lower-score decisions and historical replay. No report or daily schedule is activated by this module.

OCR still needs a supported-screen corpus, extraction/runtime choice, image limits, retention/privacy behavior and actual reset evidence. Mock approval alone did not authorize sending private screenshots to an external processor. File selection/preview/disposal should be part of the joined extraction-review workflow, not a separate placeholder release.

The next Human QA candidate should demonstrate real extraction alongside source evidence on phone/tablet/desktop and these review safeguards, with no silent score writes. This contract has an engineering-review gate first. The production site remains at the separately approved #397 release while that candidate is prepared.
