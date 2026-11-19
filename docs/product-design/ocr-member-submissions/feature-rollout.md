# OCR selected-user rollout qualification

Issue #405; lifecycle follow-up #406. PR #403 was merged after owner Human QA, independent review and green CI at `c66d94e0e021a3a4be9501e3ce8e2ef993a4ef2c`. Its automatic production build was canceled by the verified ignored-build hold before installation or migrations; the live alias remained on `dpl_7TRqyEtUiVCahPeSkLjntx2yQJ77`.

## Scope

Use the existing `ocr-screenshot-evaluation` registry/provider flag, with both DB-authorized user and alliance identities. All existing OCR authorization, identity, source-alliance, calendar and resource safeguards remain. Off blocks discovery, direct screenshot routes, reads, reservation/dispatch and the QA name editor. History and costs remain intact. No accepted-score writes, production exposure, new Google calls or budget reset are authorized by this slice.

The existing `codex/ocr-recognition-trial` branch incorporates the merged main commit and is reused for this follow-up so the approved branch pin and cloud trust do not change. The PR diff against main contains only #405 work. The custom environment and permanent QA origin remain unchanged; this is not a production deployment.

## Verification record

Pending final source review, CI and hosted on/off qualification. The provider flag has been created; Production, Preview and Development start Off. Live cohort membership is provider configuration, not this document. Do not interpret source tests or a saved provider rule as hosted success. New Human QA is required for this changed candidate; merge and production remain held.
