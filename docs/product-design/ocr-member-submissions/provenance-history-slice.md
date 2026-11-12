# First implementation: metric attribution and entry history

Part of #42, #287 and #295. The approved [responsive design](README.md) remains the target for the complete screenshot-submission workflow. This first vertical slice records attribution on today's supported manual/spreadsheet writes and makes those entries inspectable in **Go back in time**. It does not enable OCR or ordinary-member access.

## Data and authorization contract

- Extend `MemberMetricEntry` with the entering account's immutable internal ID, display-name snapshot, alliance-role snapshot, and method (`MANUAL`, `SPREADSHEET_SINGLE_PERIOD`, `SPREADSHEET_MULTI_PERIOD`). No email address or workbook filename is copied into history.
- Capture the actor from the authenticated account, never from the submitted data. Inside the same write transaction, re-read and share-lock the membership and profile, recheck import and any required configuration permissions, then stamp every entry. A concurrent role/profile change waits for the batch, or is observed before admission. A role change does not rewrite old attribution.
- The snapshot ID intentionally has no account FK: account removal must not cascade or attempt a forbidden update of an immutable metric entry. This is historical evidence, not an authentication/authorization grant. Existing whole-row immutability protects every new field.
- A CHECK constraint permits complete attribution or all-null unknown attribution, never a partial claim. The forward-only additive migration leaves old rows untouched and allows old application instances, seed/audit fixtures and migration tools to continue inserting unattributed entries during the compatibility window. The application has no fallback that silently discards attribution on new writes.
- All three production write paths stamp attribution. No production correction/void UI currently exists; a future one must use the same boundary. Current daily-entry guards remain in place.

## Read contract and honest limits

- Authorize `VIEW_MEMBERS` on the server. Scope the subject, metric filter, selected entry and pagination anchor to the same alliance/member. Existing collaborator permissions remain unchanged; this is not a self-service member portal.
- Read at most 26 entries (25 visible plus continuation). Use keyset pagination ordered by `(recordedAt, createdAt, id)` descending, including explicit tie cases. A newly inserted entry cannot shift the continuation boundary. Metadata lists contain only this member's metrics. Archived members and inactive metrics/periods retain history.
- Each detail displays the **recorded value**, actor and role at entry, method, period, recorded UTC time, and observation date when present. Historical records that lack attribution say so. Zero is shown as zero and a void is shown as a void, never as zero.
- This slice does **not** label a saved value Final or In progress: today's writes did not capture that evidence. It does not infer source capture time, screenshot verification, uploader, or historical authority from current state. Metric/period labels and unit labels are current configuration, not historical name snapshots.
- This is an entry ledger, **not yet** the approved “effective record as known then” replay. ADR-018's tuple is a deterministic correction order, not a transaction-commit clock. Do not add an as-of report by treating an entry timestamp as proof of what was visible then. The submission/decision model, stable knowledge boundary, concurrency qualification, finality and leader-over-member precedence remain a later contract before any member ingestion is enabled.
- Reports, rollups, aggregation, score precedence and all current consumers keep ADR-018 behavior. Browsing history never mutates data. Raw images are not accepted, stored, sent to a provider or promised indefinite retention.

## UI and QA

Member detail → **Go back in time** → metric filter → bounded recorded-history list → selected entry. Phones use the approved separate detail / All history pattern; tablets and desktop show the list beside the selected entry. All routes inherit the existing app identity and Private beta header.

Automated acceptance covers real database persistence, attribution immutability, legacy compatibility, permission changes and locking, scoped deep links, keyset ties/pagination, zero/void history and unchanged canonical values. Browser QA covers saving an entry, changing it without erasing the earlier entry, reloading history, phone/tablet layout, keyboard navigation and accessibility. Existing required CI and independent review still apply. Human QA is the next gate; merge and production deployment remain separate.

### Final leader confirmation

Manual entry and both spreadsheet import paths require an explicit **Apply this data?** dialog before the mutation. The warning lists the metric, destination period and entry count, explains the effect on results/reports, and states that earlier entries remain in **Go back in time**. **Yes, apply data** sends the reviewed payload; Cancel or Escape returns to the form with no write. Changed data requires a fresh confirmation. The dialog handles pending/error states and fits phone, tablet and desktop screens.

This is a final UI confirmation for the currently supported leader writes, not an authorization grant or the later screenshot identity/lower-member-score decision protocol. Those server-validated protections remain required before member ingestion is enabled. A response failure does not establish rollback; the warning directs leaders to inspect history before retrying.
