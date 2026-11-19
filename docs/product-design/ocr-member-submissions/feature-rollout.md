# OCR selected-user rollout qualification

Issue #405; lifecycle follow-up #406. PR #403 was merged after owner Human QA, independent review and green CI at `c66d94e0e021a3a4be9501e3ce8e2ef993a4ef2c`. Its automatic production build was canceled by the verified ignored-build hold before installation or migrations; the live alias remained on `dpl_7TRqyEtUiVCahPeSkLjntx2yQJ77`.

## Scope

Use the existing `ocr-screenshot-evaluation` registry/provider flag, with both DB-authorized user and alliance identities. All existing OCR authorization, identity, source-alliance, calendar and resource safeguards remain. Off blocks discovery, direct screenshot routes, reads, reservation/dispatch and the QA name editor. History and costs remain intact. No accepted-score writes, production exposure, new Google calls or budget reset are authorized by this slice.

The existing `codex/ocr-recognition-trial` branch incorporates the merged main commit and is reused for this follow-up so the approved branch pin and cloud trust do not change. The PR diff against main contains only #405 work. The custom environment and permanent QA origin remain unchanged; this is not a production deployment.

## Verification record

Initial source commit `6e3d77f` passed independent review (80 focused tests and typecheck independently; 168 focused tests locally). PostgreSQL integration, unit, build, type/lint, accessibility and visual CI passed while broader browser checks continued. The subsequent owner-requested local-time display correction requires final review and CI.

Hosted qualification on isolated deployment `dpl_DjJhW2K4tK4fxFNJiRH53nGf9eaz` verified: Off returns explicit unavailable state at the direct screenshot capture URL; the exact approved account AND QA alliance rule enables it; temporarily selecting a nonexistent synthetic user in the same alliance makes that same signed-in account unavailable; restoring the approved pair enables it again. No account, role or membership was changed. The additive `alliance.id` provider entity matches the existing SDK context. Production and Development remain Off, Preview has one paired rule and Off fallback. No new credentials or paid scans were needed. Live cohort membership remains provider configuration, not this document.

The read-only QA ledger before these checks was 13 attempts / $0.13 reserved / 41 private-content reads / zero accepted metric entries; this includes intervening owner QA activity since #403's earlier snapshot. Existing failed attempts remain recorded. Source images were not reread or submitted during the rollout checks. New Human QA is required for this changed candidate; merge and production remain held.

## Upload-history time display

Owner feedback during rollout qualification requested the viewer's timezone instead of raw UTC. Ranking and individual upload history, source dialogs, retention deadlines and QA name history now format the original ISO instant in the browser's locale/timezone, including a timezone label. Server rendering uses a neutral loading label until hydration; storage, audit order, retention and the fixed game-server day/week rules do not change. Browser regressions cover New York and Tokyo, date rollover, winter/summer offsets and hydration consistency using synthetic history only.

## Human QA navigation and calendar corrections

Owner QA found that dashboard navigation still defaulted to Spreadsheet and that non-Monday week selections lacked a clear explanation. The shared capture route now defaults to Screenshots only when OCR is available for the authorized account/alliance; an explicit `method=spreadsheet` preserves spreadsheet selection, and unavailable OCR keeps the spreadsheet default.

Calendar review now explains that the input selects a week, not a replacement weekday. A non-Monday is visibly invalid and cannot be confirmed. Before assigning date windows to the recognition review, a confirmation dialog lists every screenshot's detected day and resulting date, keeping daily and weekly totals separate. Cancel/Escape leave dates unconfirmed. Changing dates or screenshots invalidates confirmation. A visible source weekday cannot be overridden; no accepted metric writes or new scans are introduced. Browser regressions start at the dashboard and cover explicit spreadsheet selection, invalid dates, confirmation/cancellation and re-confirmation at phone/tablet/desktop widths. Revised Human QA is required before merge.
