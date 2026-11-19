# First protected OCR cohort

WORD is the first requested alliance. The selected account is recorded privately by the operator. This is preparation only. No invitations, rollout grants or provider calls are part of this change.

1. Verify the privately nominated account, active membership and authorized import role in the intended WORD alliance. Resolve duplicate names or missing memberships with the owner. Record the verified internal user and alliance IDs privately.
2. Qualify the Platform evidence view and the saved-result path first. Record confirmed, corrected, failed, abandoned and open journeys, with retries in the original journey. Check manual fallback, per-account consent, an independent audit opt-in and a comparable manual baseline. Record unsupported screenshot types.
3. Before enabling a real cohort, verify deployment isolation, 30-day retention, the existing $5 testing ledger and separate counting of customer activity. A new ledger would invalidate the spending limit. Confirm how genuine pilot tasks will be enrolled separately from fixtures. The current provider and deployment are intentionally pinned to isolated QA.
4. Present the reviewed release candidate and exact eligible pair to AB for separate deployment and activation authorization. Use one paired user AND alliance rule with an Off fallback. Verify the selected person in another alliance and a different person in WORD both remain ineligible. Keep other Platform privileges separate.
5. Pause by disabling that rule. Verify direct reads and new reservations are blocked. Preserve history, consent and reservations. Review outcomes before requesting another participant or alliance.

One alliance can expose onboarding friction. It cannot meet the public-beta breadth gate. Pricing, billing and public rollout each remain separate decisions.

## Manual comparison rehearsal

Platform → OCR release readiness shows the isolated manual-entry baseline. A qualified importer starts timing before entering any values. Reloading resumes the same timer. Stopping keeps the entered values on the page and excludes that session from the saved-duration percentiles. A successful confirmation records one task and its number of saved rows in the same transaction as the scores. Untimed entries continue through the ordinary path. Elapsed time includes corrections, confirmation and time away from the page.

Platform groups saved times by row count with sample size, median and 90th percentile. These are all-time QA observations for period-value tasks. A daily VS comparison requires the same task scope and comparable row counts on both methods. QA observations never qualify the real cohort. The timing table stores opaque context IDs, timestamps and row count only.

## Production release procedure

Keep the production feature flag off during setup. Pin the nominated user and alliance IDs in production only. The existing role and account-consent checks run on every batch. The real pilot supports leader ranking batches. Member-specific uploads and the QA alliance editor remain isolated.

QA owns the original 500-cent testing ledger. Only the enrolled production operator test account asks the stable QA endpoint to reserve one cent for an opaque attempt UUID before storing or recognizing an image. The endpoint verifies Vercel's signed production identity, project, team, expiration and reservation-specific audience. Each signed reservation can succeed once. Missing or uncertain acknowledgments stop processing. Genuine customer scans and retries are counted in production attempt history and do not consume the testing allowance. Prior reservations and failed attempts remain recorded. The production database tracks local activity, never the available combined balance. Query the existing QA ledger for that balance. All production Google calls use the separate production federation and private 30-day bucket. Both buckets must pass the same retention preflight.

Production requires both OCR_PILOT_ENABLED and OCR_EVAL_ENABLED, the main production build, verified production DB identity and a private bucket in the Aptelum project. The QA reservation endpoint also requires OCR_PILOT_RESERVATIONS=true in the evaluation environment. Disable client telemetry and replay for this pilot. Server error monitoring suppresses OCR routes, member history, mutations and unclassified events during the pilot. Platform administrators can view live aggregate scan and save counts separately from QA. These do not establish accuracy, time savings or a usable-import rate.

Before activation, confirm privacy settings, production federation, the exact paired targeting rule with fallback Off and the existing signed-in account's Word import role. Verify denied contexts, retained history and allowance before/after a controlled scan. Revoke the paired rule to stop OCR without undoing accepted scores.

An approved production test account can have its own exact user–alliance rule and separate environment pins (`OCR_PILOT_TEST_USER_ID` and `OCR_PILOT_TEST_ALLIANCE_ID`). Both pins and a matching flag rule are required for capture. Test scans use the same lifetime allowance. The production readiness report continues to query only the original measured pair. Disable the test rule to pause its access independently.

A fresh temporary service error can trigger one retry after two seconds. The retry repeats authorization, consent and admission checks. Upload history links the original failure and the second attempt. Connection loss, unreadable output, and reopening an upload do not trigger retries.
