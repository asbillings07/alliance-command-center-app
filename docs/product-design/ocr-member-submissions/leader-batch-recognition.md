# Leader batch recognition trial

PR #403 extends the managed recognition trial to the existing evaluation-results import page. Leaders, Admins and Owners choose Screenshots beside Spreadsheet and Manual entry, upload up to 20 images, and review all recognized roster candidates together. Ordinary members retain the separate own-record permission boundary.

## Source context

- A ranking image must visibly establish the highlighted Daily Rank tab plus one selected weekday, or the highlighted Weekly Rank tab. Merely reading both labels is insufficient. Missing or ambiguous selection leaves the image unresolved.
- A weekday is not a calendar date. The reviewer selects a Monday week start and confirms the calendar context. Weekly totals retain a distinct weekly window and are never added to daily scores.
- Today's Duel is a separate supported layout. Only a confirmed current game date plus a nonzero visible countdown produces a current-day progress notice. The fixed reset is 01:00 UTC; local daylight-saving changes do not shift it.
- Absence of a countdown never establishes finality. Neither upload time nor an editable date proves when the image was captured.

## Matching and review

The existing source-neutral import matcher supplies roster suggestions and the canonical integer parser validates points. Full exact names remain distinct from fuzzy suggestions, duplicate names, unreadable values and archived members. Each candidate retains its image reference. Identical overlaps collapse only for an exact member and the same confirmed result window; conflicting values remain unresolved.

This slice stops at recognition review. It does not insert accepted metric entries or change reports. Member identity blockers, leader mismatch resolution, lower-score confirmation, authoritative provenance and final-score acceptance must be connected through the shared score-acceptance contract (#400 / PR #401), not bypassed via the existing weekly import writer.

## Limits and privacy

All scans share the existing immutable attempt history and monotonic $5 / 500-attempt allowance. Each newly dispatched image reserves $0.01; identical images in the same actor/alliance/context reuse their retained attempt, including failed or uncertain attempts. A new client request ID is not a retry grant. Reads stay bounded and reauthorize after storage access.

Batch attempts have no target member, are restricted to the existing import permission, and cannot be read through the member-only route. Images and recognition remain private for 30 days and use the same deletion preflight. Telemetry remains disabled in the isolated environment. Production, ordinary Preview and accepted member scores remain unchanged.

Tests use invented names and screenshots. Real owner-supplied images and recognized player data stay outside GitHub. Human QA is required on the revised hosted flow before merge; production deployment is a separate approval.
