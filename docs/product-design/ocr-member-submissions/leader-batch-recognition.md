# Leader batch recognition trial

PR #403 extends the managed recognition trial to the existing evaluation-results import page. Leaders, Admins and Owners choose Screenshots beside Spreadsheet and Manual entry, upload up to 20 images, and review all recognized roster candidates together. Ordinary members retain the separate own-record permission boundary.

The workflow is named **Capture Evaluation Results** across navigation, setup and page headings to cover manual entry, spreadsheets and screenshots. Existing routes and permission boundaries are unchanged. Both image and member-source controls open a read-only native modal above the current review, with focus containment/return, Escape and a visible close control. Fit/enlarge controls and an independently scrolling image region support phone, tablet and desktop inspection. Loading and unavailable-image messages appear inside the modal; closing it preserves the review and never sends another OCR request.

Use the permanent [OCR QA origin](https://alliance-command-center-env-acc-ocr-eval-aptelum-labs.vercel.app) for all user-facing previews. Subsequent reviewed `acc-ocr-eval` deployments update this same alias; record immutable deployment IDs and commit hashes separately. The stable origin retains the isolated QA account/database and does not authorize production or broaden access.

## Source context

- A ranking image must visibly establish the highlighted Daily Rank tab plus one selected weekday, or the highlighted Weekly Rank tab. Merely reading both labels is insufficient. Missing or ambiguous selection leaves the image unresolved.
- A weekday is not a calendar date. The reviewer selects a Monday week start, sees each screenshot's resulting date/window, and confirms once for the batch. Different weeks need separate reviews. Weekly totals retain a distinct weekly window and are never added to daily scores.
- Today's Duel is a separate supported layout. Only a confirmed current game date plus a nonzero visible countdown produces a current-day progress notice. The fixed reset is 01:00 UTC; local daylight-saving changes do not shift it.
- Absence of a countdown never establishes finality. Neither upload time nor an editable date proves when the image was captured.

## Matching and review

The existing source-neutral import matcher supplies roster suggestions and the canonical integer parser validates points. Full exact names remain distinct from fuzzy suggestions, duplicate names, unreadable values and archived members. Each candidate retains its image reference. Identical overlaps collapse only for an exact member and the same confirmed result window; conflicting values remain unresolved.

Monday and Weekly Rank for the same member/week can coexist in one review: the weekly total includes Monday, so the two are neither summed nor treated as competing values. The current slice does **not** compare weekly totals against daily observations. That future comparison must account for incomplete daily coverage and different capture times, flag inconsistencies for leadership, and never invent missing daily results. Upload order is not capture-time evidence.

### Source alliance boundary — owner QA correction

A leader may capture results only for an alliance in which they hold the existing import permission, and the screenshot itself must match that alliance. This is a hard source-alliance boundary, distinct from the future leader override for a member-name discrepancy. There is no source-alliance override.

The server compares visible row alliance tags/full names against the saved alliance name, using only Unicode normalization, whitespace and case normalization. There is no fuzzy, accent-stripping or substring match. The current alliance model has one name, not a separately verified tag; either an exact tag or exact full-name match is supported. A configured `[TAG] Full name` must agree with both when shown. Missing/unreadable row evidence, mixed alliances, nonmatching alliances and a reliably associated conflicting server are blocked. A ranking without a server number does not establish server identity. The in-game **Your Alliance** filter is guidance, not identity proof; matching player names cannot override contradictory alliance evidence.

New source rejections preserve a terminal `FAILED` audit with a specific `alliance-*` outcome, the consumed reservation and private retention schedule. They expose no result candidates or private source through the review API and cannot use the processing-failure paid retry control. A confirmed source rejection excludes that image and continues through the other selected, consented images. Every rejected image keeps its own warning. Processing uncertainty, changed access or cancellation still stops dispatch, leaving unstarted images unclassified. Removing a blocked item only removes it from the current review.

When every image in the current review is rejected for an alliance mismatch, show a foreground notice that none match the selected alliance. If every image is blocked but some evidence is mixed or unreadable, explain that none could be verified rather than claiming all belong elsewhere. A mixed batch retains matching results and individual warnings without the whole-batch notice. Failed or unstarted images never count as confirmed mismatches. Closing the notice preserves every warning and history entry; it does not accept data or retry processing. This applies to every authorized import role, and to single-image and own-record uploads as well as the batch route.

Older `READY` scans are requalified on every result/image read without rewriting history or calling Google again. Reopening a rejected retained scan creates the same per-image warning and, where applicable, whole-review notice. Individual leader and own-record uploads use the same source check, so a Leader with an approved own-record link cannot bypass it by switching routes. Ordinary-member identity/grant eligibility remains unchanged.

The private trial alliance began synthetic. Earlier real samples from a different alliance remain historical provider/parser evidence and are blocked when reopened against that original synthetic target. The owner subsequently approved editing the isolated QA alliance name to test the same source file against a matching target. Use the explicit QA setup workflow below; never relabel old attempts or describe those previous rejections as successful qualification.

### QA alliance-name setup — owner-approved testing

Authorized importers (Owner, Admin and Leader, including the approved QA account) may edit only the allowlisted QA alliance's name from **Edit QA alliance name** in the batch capture screen (#404). Reuse the existing `canImportMetrics` permission only within this isolated test setup; this does not grant production alliance-management authority. The server checks the dedicated environment/branch, disabled telemetry, allowlist and verified database isolation before any query, and reauthorizes the importer in the name-change transaction. Viewers and cross-alliance actors are denied. The server number, roles, membership, spending ledger and runtime grants cannot be edited here. This editor does not exist in production or ordinary previews.

Show current and proposed names and require explicit confirmation; cancellation writes nothing. Validate one-line names up to 200 characters, reject stale or conflicting changes, and save immutable before/after/actor/time history atomically with the rename. Existing database identity-version rules invalidate current screenshot reviews and member identity confirmations. Earlier attempts retain their source name, context, outcome, charge and retention unchanged. The same file may be selected for a fresh review under the new name; it never triggers an automatic scan or budget reset. This is QA setup, not a production source-alliance override or a completed production alliance-settings feature.

This slice stops at recognition review. It does not insert accepted metric entries or change reports. Member identity blockers, leader mismatch resolution, lower-score confirmation, authoritative provenance and final-score acceptance must be connected through the shared score-acceptance contract (#400 / PR #401), not bypassed via the existing weekly import writer.

## Limits and privacy

Selecting a screenshot again and choosing **Read** starts a fresh recognition attempt if processing previously failed. **Retry scan** remains available on eligible failed cards. Both paths link the new attempt to the failure in upload history. Replaying the same request, reopening a completed scan, or finding a scan still processing reuses its attempt. Alliance rejections continue to block the upload. Every fresh dispatch rechecks access, consent and the applicable resource limits. QA and designated test accounts share the $5 testing allowance. Reads stay bounded and reauthorize after storage access.

Batch attempts have no target member, are restricted to the existing import permission, and cannot be read through the member-only route. Images and recognition remain private for 30 days and use the same deletion preflight. Telemetry remains disabled in the isolated environment. Production, ordinary Preview and accepted member scores remain unchanged.

Tests use invented names and screenshots. Real owner-supplied images and recognized player data stay outside GitHub. Human QA is required on the revised hosted flow before merge; production deployment is a separate approval.

## Initial real-sample qualification (2026-11-18)

The owner authorized three private ranking screenshots. Monday and Weekly Rank were recognized by Google and their highlighted source contexts were identified correctly. Real column geometry exposed an association bug not represented by the original synthetic fixture; parser regressions now cover centered headers, large rank glyphs, full long names and missing adjacent text. Re-parsing the two retained responses yields all eight visible rows per image without further OCR calls. Recognized name spelling/case can still differ from the source; exact identity is never inferred from a fuzzy match.

The Tuesday attempt failed after its private source image was stored; no recognition object was retained. Neither the generic historical failure nor available logs identify its exact failure stage. That failure is preserved, not reset or relabeled successful. The one separately approved retry also failed, recording `processing-failed:recognition`. That stage includes recognition and local validation, so it does not establish a specific provider fault. The retry links to its immutable failed parent. No further retry is authorized or scheduled; this record does not claim that all three real samples passed.

The same lifetime ledger reached seven attempts / $0.07 reserved, including three earlier attempts, the three owner-approved tests and one approved retry. No accepted member scores were inserted. Original images, recognized player data and private diagnostic responses remain outside GitHub.
